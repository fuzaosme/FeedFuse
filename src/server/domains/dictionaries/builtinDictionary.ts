import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isRecord } from '@/lib/utils';
import { normalizeVocabularyTerm } from '@/lib/englishLearning';
import type { DictionaryEntryValue } from '@/types/dictionaries';

export const BUILTIN_DICTIONARY_ID = 'builtin-ecdict-core';
export const BUILTIN_DICTIONARY_NAME = '内置核心词库';
export const BUILTIN_DICTIONARY_DESCRIPTION =
  '考试大纲词汇与高频词（约 2.9 万条），随应用内置，无需下载即可查词。';

export const BUILTIN_DICTIONARY_PATH = path.join(
  process.cwd(),
  'public',
  'dictionaries',
  'en-zh.json',
);

/** 前缀联想上限：排序数组二分定位 + 线性扫描，limit 很小时与 Trie 同为毫秒级。 */
export const BUILTIN_PREFIX_SUGGESTION_LIMIT = 10;
const BUILTIN_PREFIX_SUGGESTION_HARD_LIMIT = 50;

let cache: Promise<Map<string, DictionaryEntryValue>> | null = null;
/** 排序后的词条键：前缀索引。精确查询走 Map O(1)，前缀联想走有序数组二分 O(log n)。 */
let sortedTermsCache: Promise<readonly string[]> | null = null;

function parseBuiltinDictionary(text: string): Map<string, DictionaryEntryValue> {
  const data: unknown = JSON.parse(text);
  if (!isRecord(data)) throw new Error('Invalid dictionary');
  const entries = new Map<string, DictionaryEntryValue>();
  for (const [term, value] of Object.entries(data)) {
    if (!isRecord(value) || !Array.isArray(value.meanings) || !value.meanings.length) continue;
    const meanings = value.meanings.filter(
      (meaning): meaning is string => typeof meaning === 'string' && meaning.trim().length > 0,
    );
    if (!meanings.length) continue;
    if (value.phonetic !== undefined && typeof value.phonetic !== 'string') continue;
    entries.set(normalizeVocabularyTerm(term), {
      meanings,
      phonetic: typeof value.phonetic === 'string' ? value.phonetic : undefined,
    });
  }
  return entries;
}

/** 内置词典只在首次使用时读入内存，解析失败不会长期缓存错误结果。 */
export function loadBuiltinDictionary(): Promise<Map<string, DictionaryEntryValue>> {
  if (cache) return cache;
  cache = (async () => {
    const text = await readFile(BUILTIN_DICTIONARY_PATH, 'utf8');
    return parseBuiltinDictionary(text);
  })().catch((error: unknown) => {
    cache = null;
    throw error;
  });
  return cache;
}

/**
 * 服务端预热：在进程启动时调用，把冷启动的文件读取 + JSON 解析提前到空闲期，
 * 首个查词请求只剩 Map O(1) 查询。失败返回 0，由调用方降级（不抛错，避免拖累启动）。
 *
 * 选型结论：精确查询场景下 Map 哈希已是最优，Trie 仅对前缀联想有意义；
 * 因此内存结构 = Map（精确）+ 惰性排序数组（二分前缀），不引入 Trie 的额外内存。
 */
export async function warmBuiltinDictionary(): Promise<number> {
  try {
    const entries = await loadBuiltinDictionary();
    // 顺带预热前缀索引，避免首个联想请求承担排序开销。
    await loadSortedBuiltinTerms();
    return entries.size;
  } catch {
    return 0;
  }
}

function loadSortedBuiltinTerms(): Promise<readonly string[]> {
  if (sortedTermsCache) return sortedTermsCache;
  sortedTermsCache = loadBuiltinDictionary()
    .then((entries) => [...entries.keys()].sort())
    .catch((error: unknown) => {
      sortedTermsCache = null;
      throw error;
    });
  return sortedTermsCache;
}

function lowerBound(sorted: readonly string[], prefix: string): number {
  let left = 0;
  let right = sorted.length;
  while (left < right) {
    const mid = (left + right) >>> 1;
    if (sorted[mid] < prefix) left = mid + 1;
    else right = mid;
  }
  return left;
}

/** 前缀联想：返回按字典序的前 limit 个词条键，文件缺失时返回空数组。 */
export async function getBuiltinPrefixSuggestions(
  rawPrefix: string,
  limit = BUILTIN_PREFIX_SUGGESTION_LIMIT,
): Promise<string[]> {
  const prefix = normalizeVocabularyTerm(rawPrefix);
  if (!prefix) return [];
  const capped = Math.min(Math.max(limit, 1), BUILTIN_PREFIX_SUGGESTION_HARD_LIMIT);
  try {
    const sorted = await loadSortedBuiltinTerms();
    const suggestions: string[] = [];
    for (let i = lowerBound(sorted, prefix); i < sorted.length && suggestions.length < capped; i += 1) {
      const term = sorted[i];
      if (!term.startsWith(prefix)) break;
      suggestions.push(term);
    }
    return suggestions;
  } catch {
    return [];
  }
}

export interface BuiltinDictionaryStats {
  entryCount: number;
  bytes: number;
}

export async function getBuiltinDictionaryStats(): Promise<BuiltinDictionaryStats> {
  const [entries, fileStat] = await Promise.all([
    loadBuiltinDictionary(),
    stat(BUILTIN_DICTIONARY_PATH),
  ]);
  return { entryCount: entries.size, bytes: fileStat.size };
}

export async function lookupBuiltinDictionary(
  normalizedTerm: string,
): Promise<DictionaryEntryValue | null> {
  try {
    const entries = await loadBuiltinDictionary();
    return entries.get(normalizedTerm) ?? null;
  } catch {
    // 内置词典缺失不应让整个查词失败，交由调用方降级为「未收录」。
    return null;
  }
}
