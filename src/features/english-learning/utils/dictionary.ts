import { lookupServerDictionary } from '@/lib/api/apiClient';
import { getInstalledDictionaryCount, getInstalledDictionarySnapshot } from '@/lib/dictionaries/installedDictionaryCache';
import { dictionaryLookupCandidates, normalizeVocabularyTerm } from '@/lib/englishLearning';
import { isRecord } from '@/lib/utils';
import { recordReadingTiming } from '@/lib/readingTiming';
import type { DictionaryEntryValue, DictionaryLookupResult } from '@/types/dictionaries';

export type DictionaryEntry = DictionaryEntryValue;
export type DictionaryResult = DictionaryLookupResult;

const LOCAL_DICTIONARY_URL = '/dictionaries/en-zh.json';
export const DICTIONARY_LOOKUP_TIMEOUT_MS = 1_200;
let cacheRevision = -1;

/** 归一化结果缓存：划词/连续查词会反复归一化同一字符串，命中即省一次正则+大小写转换。 */
const NORMALIZE_CACHE_LIMIT = 2000;
const normalizeCache = new Map<string, string>();

/**
 * 热点查询结果 LRU：只缓存「稳定」结果（found / not_found）。
 * error 随网络波动、unconfigured 随词典安装状态变化，均不缓存。
 */
const RESULT_CACHE_LIMIT = 500;
const resultCache = new Map<string, { result: DictionaryResult; expiresAt: number }>();

/** 同词并发请求合并：N 个并行查同一词只产生一次本地解析 + 一次远端请求。 */
const inflightLookups = new Map<string, Promise<DictionaryResult>>();

function cachedNormalize(term: string): string {
  const cached = normalizeCache.get(term);
  if (cached !== undefined) return cached;
  const normalized = normalizeVocabularyTerm(term);
  if (normalizeCache.size >= NORMALIZE_CACHE_LIMIT) {
    const oldest = normalizeCache.keys().next();
    if (!oldest.done) normalizeCache.delete(oldest.value);
  }
  normalizeCache.set(term, normalized);
  return normalized;
}

function getCachedResult(normalized: string): DictionaryResult | null {
  const cached = resultCache.get(normalized);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(normalized);
    return null;
  }
  // LRU：命中即移到末尾，下次淘汰最久未用。
  resultCache.delete(normalized);
  resultCache.set(normalized, cached);
  return cached.result;
}

function setCachedResult(normalized: string, result: DictionaryResult): void {
  if (result.status !== 'found' && result.status !== 'not_found') return;
  if (resultCache.has(normalized)) resultCache.delete(normalized);
  else if (resultCache.size >= RESULT_CACHE_LIMIT) {
    const oldest = resultCache.keys().next();
    if (!oldest.done) resultCache.delete(oldest.value);
  }
  resultCache.set(normalized, {
    result, expiresAt: Date.now() + (result.status === 'found' ? 5 * 60_000 : 30_000),
  });
}

/** 保留完整表达的等价写法，不把前缀单词当作词组命中。 */
export const buildPhraseFallbackCandidates = dictionaryLookupCandidates;

/** 单测/调试用：清空归一化与结果缓存。 */
export function clearDictionaryCaches(): void {
  normalizeCache.clear();
  resultCache.clear();
  inflightLookups.clear();
}

let dictionaryPromise: Promise<Map<string, DictionaryEntry>> | null = null;

/**
 * 内置核心词库随应用一起发布，直接由静态资源提供：
 * 常见词不依赖接口，断网或接口异常时仍可查词。
 */
function loadLocalDictionary(): Promise<Map<string, DictionaryEntry>> {
  if (dictionaryPromise) return dictionaryPromise;
  dictionaryPromise = (async () => {
    const response = await fetch(LOCAL_DICTIONARY_URL, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error('Dictionary could not be loaded');
    const data: unknown = await response.json();
    if (!isRecord(data)) throw new Error('Invalid dictionary');
    const entries = new Map<string, DictionaryEntry>();
    for (const [term, value] of Object.entries(data)) {
      if (!isRecord(value) || !Array.isArray(value.meanings) || !value.meanings.length ||
          !value.meanings.every((meaning) => typeof meaning === 'string' && meaning.trim()) ||
          (value.phonetic !== undefined && typeof value.phonetic !== 'string')) {
        throw new Error('Invalid dictionary entry');
      }
      entries.set(cachedNormalize(term), {
        meanings: value.meanings as string[],
        phonetic: value.phonetic as string | undefined,
      });
    }
    return entries;
  })().catch((error: unknown) => {
    dictionaryPromise = null;
    throw error;
  });
  return dictionaryPromise;
}

async function lookupLocalDictionary(term: string): Promise<DictionaryResult> {
  try {
    const dictionary = await loadLocalDictionary();
    if (!dictionary.size) return { status: 'unconfigured' };
    for (const candidate of buildPhraseFallbackCandidates(cachedNormalize(term))) {
      const entry = dictionary.get(candidate);
      if (entry) return { status: 'found', entry, dictionaryId: 'builtin-ecdict-core' };
    }
    return { status: 'not_found' };
  } catch {
    return { status: 'error' };
  }
}

/** 返回 null 表示接口不可用，调用方应继续使用本地结果。 */
async function lookupRemoteDictionary(term: string): Promise<DictionaryResult | null> {
  try {
    const { result } = await lookupServerDictionary(
      term, { notifyOnError: false }, AbortSignal.timeout(DICTIONARY_LOOKUP_TIMEOUT_MS),
    );
    return result;
  } catch {
    return null;
  }
}

// 服务端已把所有短语候选合并到一次 SQL，客户端不再重复串行请求。

export function warmLearningDictionaries(): void {
  void loadLocalDictionary().catch(() => undefined);
  void getInstalledDictionaryCount();
}

function mergeResults(
  local: DictionaryResult,
  remote: DictionaryResult | null,
): DictionaryResult {
  if (remote?.status === 'found') return remote;
  if (local.status === 'found') return local;
  // 内置词库为空说明整体没有可用词典，比接口的「未收录」更准确。
  if (local.status === 'unconfigured' && (remote === null || remote.status === 'not_found')) {
    return local;
  }
  return remote ?? local;
}

/**
 * 查词顺序：
 * - 安装了额外词典时先查服务端（用户导入的词典优先级更高）；
 * - 否则先用内置词库命中常见词，未收录再去服务端找扩展词典；
 * - 接口不可用时始终回退到本地结果。
 */
export async function lookupDictionary(term: string): Promise<DictionaryResult> {
  const snapshot = getInstalledDictionarySnapshot();
  if (cacheRevision !== snapshot.revision) {
    clearDictionaryCaches();
    cacheRevision = snapshot.revision;
  }
  const normalized = cachedNormalize(term);
  const cached = getCachedResult(normalized);
  if (cached) return cached;
  const inflight = inflightLookups.get(normalized);
  if (inflight) return inflight;

  let current: Promise<DictionaryResult> | null = null;
  const startedAt = performance.now();
  const task = (async (): Promise<DictionaryResult> => {
    // 未知时直接查服务端以保留扩展词典优先级，不等列表刷新。
    const hasInstalled = snapshot.count === null || snapshot.count > 0;
    let cacheable = true;

    let result: DictionaryResult;
    if (hasInstalled) {
      const localTask = lookupLocalDictionary(term);
      const remote = await lookupRemoteDictionary(term);
      cacheable = remote !== null && remote.status !== 'error';
      if (remote?.status === 'found') result = remote;
      else result = mergeResults(await localTask, remote);
    } else {
      const local = await lookupLocalDictionary(term);
      if (local.status === 'found') result = local;
      else {
        const remote = await lookupRemoteDictionary(term);
        cacheable = remote !== null && remote.status !== 'error';
        result = mergeResults(local, remote);
      }
    }
    if (cacheable && getInstalledDictionarySnapshot().revision === snapshot.revision) {
      setCachedResult(normalized, result);
    }
    return result;
  })().finally(() => {
    recordReadingTiming('dictionary', startedAt);
    if (inflightLookups.get(normalized) === current) inflightLookups.delete(normalized);
  });
  current = task;
  inflightLookups.set(normalized, task);
  return task;
}
