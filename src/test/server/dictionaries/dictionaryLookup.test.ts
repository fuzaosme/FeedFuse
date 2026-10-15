import { describe, expect, it, vi } from 'vitest';
import {
  buildDictionaryFallbackCandidates,
  clearDictionaryLookupCache,
  lookupDictionaryTerm,
} from '@/server/domains/dictionaries/dictionariesService';
import {
  BUILTIN_DICTIONARY_ID,
  getBuiltinPrefixSuggestions,
  warmBuiltinDictionary,
} from '@/server/domains/dictionaries/builtinDictionary';

function mockPool(entries: { term: string; dictionaryId?: string }[]) {
  return {
    query: vi.fn(async () => ({
      rows: entries.map((entry) => ({
        dictionary_id: entry.dictionaryId ?? 'ecdict-full',
        term: entry.term,
        meanings: ['释义'],
        phonetic: '',
      })),
    })),
  } as never;
}

describe('buildDictionaryFallbackCandidates', () => {
  it('单 token 无额外候选', () => {
    expect(buildDictionaryFallbackCandidates('fuse')).toEqual(['fuse']);
  });

  it('不把前缀词语冒充完整词组', () => {
    expect(buildDictionaryFallbackCandidates('take off sth')).toEqual([
      'take off sth',
      'take-off-sth',
    ]);
  });

  it('连字符与空格互换作为兜底', () => {
    expect(buildDictionaryFallbackCandidates('take-off')).toContain('take off');
    expect(buildDictionaryFallbackCandidates('take off')).toContain('take-off');
  });

  it('空输入返回空数组', () => {
    expect(buildDictionaryFallbackCandidates('')).toEqual([]);
  });
});

describe('lookupDictionaryTerm 算法层', () => {
  it('词典变化前的在途请求不能重新填回已失效缓存', async () => {
    clearDictionaryLookupCache();
    let resolveQuery!: (value: { rows: unknown[] }) => void;
    const query = vi.fn().mockReturnValueOnce(new Promise((resolve) => { resolveQuery = resolve; }));
    const pool = { query } as never;
    const pending = lookupDictionaryTerm(pool, 'fuse');
    clearDictionaryLookupCache();
    resolveQuery({ rows: [{ dictionary_id: 'old', term: 'fuse', meanings: ['旧释义'], phonetic: '' }] });
    await pending;
    query.mockResolvedValue({ rows: [{ dictionary_id: 'new', term: 'fuse', meanings: ['新释义'], phonetic: '' }] });
    expect(await lookupDictionaryTerm(pool, 'fuse')).toMatchObject({ dictionaryId: 'new' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('完整短语未收录时不能用前缀词的释义冒充', async () => {
    clearDictionaryLookupCache();
    // PG 只收录 take off，不能当作 take off sth 的整体释义。
    const pool = mockPool([{ term: 'take off' }]);
    const result = await lookupDictionaryTerm(pool, 'take off sth');
    expect(result).toEqual({ status: 'not_found' });
  });

  it('热点 LRU：第二次同词查询不再访问 PG', async () => {
    clearDictionaryLookupCache();
    const pool = mockPool([{ term: 'fuse' }]);
    await lookupDictionaryTerm(pool, 'fuse');
    await lookupDictionaryTerm(pool, 'fuse');
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('N 并行同词合并为一次 PG 查询', async () => {
    clearDictionaryLookupCache();
    const pool = mockPool([{ term: 'fuse' }]);
    const results = await Promise.all([
      lookupDictionaryTerm(pool, 'fuse'),
      lookupDictionaryTerm(pool, 'fuse'),
      lookupDictionaryTerm(pool, 'Fuse'),
    ]);
    expect(results.every((r) => r.status === 'found')).toBe(true);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('PG 异常降级为 error 且不缓存', async () => {
    clearDictionaryLookupCache();
    const pool = { query: vi.fn(async () => { throw new Error('down'); }) } as never;
    expect(await lookupDictionaryTerm(pool, 'fuse')).toEqual({ status: 'error' });
    expect(await lookupDictionaryTerm(pool, 'fuse')).toEqual({ status: 'error' });
    expect(pool.query).toHaveBeenCalledTimes(2);
  });
});

describe('builtin 预热与前缀索引', () => {
  it('warmBuiltinDictionary 预热全部词条', async () => {
    const count = await warmBuiltinDictionary();
    expect(count).toBeGreaterThan(20_000);
  });

  it('前缀联想返回字典序候选', async () => {
    const suggestions = await getBuiltinPrefixSuggestions('tak', 5);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.length).toBeLessThanOrEqual(5);
    for (const term of suggestions) expect(term.startsWith('tak')).toBe(true);
    expect([...suggestions].sort()).toEqual(suggestions);
  });

  it('无意义前缀返回空数组', async () => {
    expect(await getBuiltinPrefixSuggestions('   ')).toEqual([]);
    expect(await getBuiltinPrefixSuggestions('zzz-no-such-prefix-zzz')).toEqual([]);
  });

  it('builtin id 常量保持不变', () => {
    expect(BUILTIN_DICTIONARY_ID).toBe('builtin-ecdict-core');
  });
});

describe('服务端所有格查询', () => {
  it('同一次查询包含原词和 military 所有格词干', async () => {
    clearDictionaryLookupCache();
    const pool = mockPool([{ term: 'military' }]);
    expect(await lookupDictionaryTerm(pool, 'military’s')).toMatchObject({ status: 'found' });
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([["military's", 'military']]));
  });

  it('缩写不会生成错误的普通词候选', () => {
    expect(buildDictionaryFallbackCandidates("it's")).toEqual(["it's"]);
    expect(buildDictionaryFallbackCandidates("don't")).toEqual(["don't"]);
  });
});
