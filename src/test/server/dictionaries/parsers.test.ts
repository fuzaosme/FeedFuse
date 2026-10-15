import { describe, expect, it } from 'vitest';
import {
  iterateAppJsonEntries,
  iterateCsvRows,
  iterateEcdictEntries,
  splitMeanings,
} from '@/server/domains/dictionaries/parsers';

const HEADER =
  'word,phonetic,definition,translation,pos,collins,oxford,tag,bnc,frq,exchange,detail,audio';

describe('splitMeanings', () => {
  it('splits on literal backslash-n used by ECDICT', () => {
    expect(splitMeanings('n. 保险丝, 导火线\\nv. 熔化, 融合')).toEqual([
      'n. 保险丝, 导火线',
      'v. 熔化, 融合',
    ]);
  });

  it('splits on real newlines and CRLF too', () => {
    expect(splitMeanings('第一行\n第二行\r\n第三行')).toEqual(['第一行', '第二行', '第三行']);
  });

  it('drops empty segments', () => {
    expect(splitMeanings('\\n\\n 释义 \\n')).toEqual(['释义']);
  });
});

describe('iterateCsvRows', () => {
  it('handles quoted commas, escaped quotes and CRLF', () => {
    const rows = [...iterateCsvRows('a,"b,1","say ""hi"""\r\nc,d,e\r\n')];
    expect(rows).toEqual([
      ['a', 'b,1', 'say "hi"'],
      ['c', 'd', 'e'],
    ]);
  });

  it('keeps real newlines inside quoted fields', () => {
    expect([...iterateCsvRows('a,"line1\nline2",c')]).toEqual([['a', 'line1\nline2', 'c']]);
  });

  it('yields the final row without a trailing newline', () => {
    expect([...iterateCsvRows('a,b')]).toEqual([['a', 'b']]);
  });
});

describe('iterateEcdictEntries', () => {
  const csv = [
    HEADER,
    'fuse,fju:z,def,"n. 保险丝\\nv. 熔化",,,,cet4,,2000,,,',
    "Zebra,'zi:brә,def,n. 斑马,,,,0,3000,,,",
    '"quo,te",kwəʊt,def,"n. 引语, 引用",,,,0,0,,,',
    'missing-translation,,def,,,,,0,0,,,',
    ',fəʊn,def,no word,,,,0,0,,,',
  ].join('\n');

  it('produces normalized terms with split meanings', () => {
    const entries = [...iterateEcdictEntries(csv)];
    expect(entries.map((entry) => entry.term)).toEqual(['fuse', 'zebra', 'quo,te']);
    expect(entries[0]).toEqual({
      term: 'fuse',
      meanings: ['n. 保险丝', 'v. 熔化'],
      phonetic: 'fju:z',
    });
    expect(entries[2].term).toBe('quo,te');
  });

  it('skips rows without translation or word', () => {
    const terms = [...iterateEcdictEntries(csv)].map((entry) => entry.term);
    expect(terms).not.toContain('missing-translation');
    expect(terms).toHaveLength(3);
  });

  it('falls back to fixed columns when the header is absent', () => {
    const entries = [...iterateEcdictEntries('alpha,ˈælfə,,中文释义,,,,0,0,,,')];
    expect(entries).toEqual([{ term: 'alpha', meanings: ['中文释义'], phonetic: 'ˈælfə' }]);
  });
});

describe('iterateAppJsonEntries', () => {
  it('reads the application dictionary shape', () => {
    const entries = [...iterateAppJsonEntries(JSON.stringify({
      Fuse: { meanings: ['保险丝', ' '], phonetic: 'fju:z' },
      broken: { meanings: [] },
      '  ': { meanings: ['忽略'] },
    }))];
    expect(entries).toEqual([{ term: 'fuse', meanings: ['保险丝'], phonetic: 'fju:z' }]);
  });

  it('rejects non-object payloads', () => {
    expect(() => [...iterateAppJsonEntries('[]')]).toThrow('单词 → 释义');
    expect(() => [...iterateAppJsonEntries('not json')]).toThrow('合法的 JSON');
  });
});
