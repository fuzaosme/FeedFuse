import type { Pool } from 'pg';
import type { DictionaryLookupResult, DictionarySummary } from '@/types/dictionaries';
import { dictionaryLookupCandidates, normalizeVocabularyTerm } from '@/lib/englishLearning';
import {
  clearDictionaryEntries,
  deleteDictionary,
  findDictionaryEntries,
  getDictionaryRecord,
  listDictionaryRecords,
  patchDictionary,
  type DictionaryRecord,
} from './dictionariesRepo';
import { DICTIONARY_MANIFEST, findManifestEntry } from './manifest';
import {
  BUILTIN_DICTIONARY_ID,
  getBuiltinDictionaryStats,
  lookupBuiltinDictionary,
} from './builtinDictionary';
import {
  buildAvailableSummary,
  buildBuiltinSummary,
  buildRecordSummary,
} from './summary';
import { activeInstallIds, abortInstall } from './installRegistry';

const INTERRUPTED_MESSAGE = '上次安装被中断，请重新下载';

/** 服务端归一化缓存：同一进程内高频词反复归一化，命中即省一次正则链。 */
const NORMALIZE_CACHE_LIMIT = 5000;
const normalizeCache = new Map<string, string>();

interface LookupCacheEntry {
  result: DictionaryLookupResult;
  expiresAt: number;
}

/**
 * 热点查询 LRU（进程内存）：
 * - found 缓存 5 分钟：词典内容几乎不变，命中即省 1 次 PG 往返；
 * - not_found 缓存 30 秒：短 TTL 避免「刚装好词典仍报未收录」长期不自愈；
 * - error 永不缓存。
 * TTL 自愈设计：安装/删除词典无需跨模块失效回调，最坏 stale 窗口即 TTL。
 */
const LOOKUP_CACHE_LIMIT = 2000;
const FOUND_CACHE_TTL_MS = 5 * 60_000;
const NOT_FOUND_CACHE_TTL_MS = 30_000;
const lookupCache = new Map<string, LookupCacheEntry>();

/** 同词并发合并：N 个并行查同一词只产生一次 PG 查询 + 内置查询。 */
const inflightLookups = new Map<string, Promise<DictionaryLookupResult>>();
let lookupRevision = 0;

function cachedNormalize(rawTerm: string): string {
  const cached = normalizeCache.get(rawTerm);
  if (cached !== undefined) return cached;
  const normalized = normalizeVocabularyTerm(rawTerm);
  if (normalizeCache.size >= NORMALIZE_CACHE_LIMIT) {
    const oldest = normalizeCache.keys().next();
    if (!oldest.done) normalizeCache.delete(oldest.value);
  }
  normalizeCache.set(rawTerm, normalized);
  return normalized;
}

function getCachedLookup(normalized: string): DictionaryLookupResult | null {
  const entry = lookupCache.get(normalized);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    lookupCache.delete(normalized);
    return null;
  }
  // LRU：命中移到末尾。
  lookupCache.delete(normalized);
  lookupCache.set(normalized, entry);
  return entry.result;
}

function setCachedLookup(normalized: string, result: DictionaryLookupResult): void {
  const ttl = result.status === 'found'
    ? FOUND_CACHE_TTL_MS
    : result.status === 'not_found' ? NOT_FOUND_CACHE_TTL_MS : 0;
  if (!ttl) return;
  if (lookupCache.has(normalized)) lookupCache.delete(normalized);
  else if (lookupCache.size >= LOOKUP_CACHE_LIMIT) {
    const oldest = lookupCache.keys().next();
    if (!oldest.done) lookupCache.delete(oldest.value);
  }
  lookupCache.set(normalized, { result, expiresAt: Date.now() + ttl });
}

/** 保留完整表达的等价写法，不把前缀单词当作词组命中。 */
export const buildDictionaryFallbackCandidates = dictionaryLookupCandidates;

/** 单测用：清空服务端归一化 / 结果 / 单飞缓存。 */
export function clearDictionaryLookupCache(): void {
  lookupRevision += 1;
  normalizeCache.clear();
  lookupCache.clear();
  inflightLookups.clear();
}

/**
 * 进程重启后数据库里可能残留 installing 状态，但已经没有对应任务。
 * 这些半成品必须清掉并标记失败，否则会被查询当成可用词典。
 */
async function reconcileInterruptedInstalls(
  pool: Pool,
  records: DictionaryRecord[],
): Promise<DictionaryRecord[]> {
  const active = new Set(activeInstallIds());
  const stale = records.filter(
    (record) => record.status === 'installing' && !active.has(record.id),
  );
  if (!stale.length) return records;
  for (const record of stale) {
    await clearDictionaryEntries(pool, record.id);
    await patchDictionary(pool, record.id, {
      status: 'error',
      error: INTERRUPTED_MESSAGE,
      entryCount: 0,
    });
  }
  return listDictionaryRecords(pool);
}

async function buildBuiltinSummarySafely(): Promise<DictionarySummary> {
  try {
    return buildBuiltinSummary(await getBuiltinDictionaryStats());
  } catch {
    return {
      id: BUILTIN_DICTIONARY_ID,
      name: '内置核心词库',
      description: '随应用内置的基础词库，当前文件不可用。',
      language: 'en-zh',
      license: 'MIT',
      attribution: 'ECDICT · Copyright (c) 2025 Linwei · MIT License',
      homepage: 'https://github.com/skywind3000/ECDICT',
      builtin: true,
      enabled: true,
      status: 'error',
      error: '内置词典文件缺失，请重新构建或部署 public/dictionaries/en-zh.json',
      entryCount: 0,
      totalEntries: 0,
      totalBytes: 0,
      downloadedBytes: 0,
      installedAt: null,
      updatedAt: null,
    };
  }
}

/**
 * 列表 = 内置词典 + 目录条目（已安装的取数据库状态）+ 用户自定义导入的词典。
 */
export async function listDictionaries(pool: Pool): Promise<DictionarySummary[]> {
  const [records, builtin] = await Promise.all([
    listDictionaryRecords(pool).then((rows) => reconcileInterruptedInstalls(pool, rows)),
    buildBuiltinSummarySafely(),
  ]);
  const byId = new Map<string, DictionaryRecord>(records.map((record) => [record.id, record]));

  const items: DictionarySummary[] = [builtin];
  for (const entry of DICTIONARY_MANIFEST) {
    const record = byId.get(entry.id);
    items.push(record ? buildRecordSummary(record) : buildAvailableSummary(entry));
    byId.delete(entry.id);
  }
  for (const record of byId.values()) {
    items.push(buildRecordSummary(record));
  }
  return items;
}

export async function setDictionaryEnabled(
  pool: Pool,
  id: string,
  enabled: boolean,
): Promise<DictionarySummary | null> {
  const record = await getDictionaryRecord(pool, id);
  if (!record || record.builtin) return null;
  const updated = await patchDictionary(pool, id, { enabled });
  clearDictionaryLookupCache();
  return updated ? buildRecordSummary(updated) : null;
}

export async function removeDictionary(pool: Pool, id: string): Promise<boolean> {
  abortInstall(id);
  const record = await getDictionaryRecord(pool, id);
  if (!record || record.builtin) return false;
  const deleted = await deleteDictionary(pool, id);
  clearDictionaryLookupCache();
  return deleted;
}

async function lookupUncached(pool: Pool, term: string): Promise<DictionaryLookupResult> {
  const candidates = buildDictionaryFallbackCandidates(term);
  // 回退候选一次 SQL 全查出（= ANY），不随候选数增加往返次数。
  const stored = await findDictionaryEntries(pool, candidates);
  if (stored.length) {
    const byTerm = new Map<string, typeof stored[number]>();
    for (const row of stored) {
      // SQL 已按 priority 全局排序：每个候选保留第一条即最高优先级。
      if (!byTerm.has(row.term)) byTerm.set(row.term, row);
    }
    for (const candidate of candidates) {
      const hit = byTerm.get(candidate);
      if (hit) {
        return {
          status: 'found',
          dictionaryId: hit.dictionaryId,
          entry: {
            meanings: hit.meanings,
            phonetic: hit.phonetic || undefined,
          },
        };
      }
    }
  }
  for (const candidate of candidates) {
    const builtin = await lookupBuiltinDictionary(candidate);
    if (builtin) {
      return { status: 'found', dictionaryId: BUILTIN_DICTIONARY_ID, entry: builtin };
    }
  }
  return { status: 'not_found' };
}

export async function lookupDictionaryTerm(
  pool: Pool,
  rawTerm: string,
): Promise<DictionaryLookupResult> {
  const term = cachedNormalize(rawTerm);
  if (!term) return { status: 'not_found' };
  const cached = getCachedLookup(term);
  if (cached) return cached;
  const inflight = inflightLookups.get(term);
  if (inflight) return inflight;

  let current: Promise<DictionaryLookupResult> | null = null;
  const startedRevision = lookupRevision;
  const task = (async (): Promise<DictionaryLookupResult> => {
    try {
      const result = await lookupUncached(pool, term);
      if (lookupRevision === startedRevision) setCachedLookup(term, result);
      return result;
    } catch {
      return { status: 'error' };
    } finally {
      if (inflightLookups.get(term) === current) inflightLookups.delete(term);
    }
  })();
  current = task;
  inflightLookups.set(term, task);
  return task;
}

export { findManifestEntry };
