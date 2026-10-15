import { isRecord } from '@/lib/utils';
import { normalizeVocabularyTerm } from '@/lib/englishLearning';

export interface DictionaryEntryInput {
  term: string;
  meanings: string[];
  phonetic: string;
}

const ECDICT_FALLBACK_COLUMNS = { word: 0, phonetic: 1, translation: 3 };

/**
 * ECDICT 的 translation 字段用「字面量反斜杠 + n」分隔多条释义，
 * 少数带引号的字段里也可能出现真实换行，两种都要拆开。
 */
export function splitMeanings(value: string): string[] {
  return value
    .split(/\r\n|\n|\\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * RFC 4180 状态机解析器。ECDICT 有 66 MB / 77 万行且字段带引号与逗号，
 * 不能按逗号切分；这里用生成器逐行产出，避免同时持有全部行对象。
 */
export function* iterateCsvRows(text: string): Generator<string[]> {
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (char === '\n') {
      row.push(field);
      field = '';
      yield row;
      row = [];
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    yield row;
  }
}

function resolveEcdictColumns(header: string[]) {
  const indexOf = (name: string) => header.indexOf(name);
  const word = indexOf('word');
  const phonetic = indexOf('phonetic');
  const translation = indexOf('translation');
  if (word < 0 || translation < 0) return ECDICT_FALLBACK_COLUMNS;
  return { word, phonetic: phonetic < 0 ? -1 : phonetic, translation };
}

/**
 * 逐条产出 ECDICT 词条。去重交给数据库的 `on conflict do nothing` 完成，
 * 这样同一 CSV 里后出现的重复词不会覆盖先出现的释义，也不需要额外内存。
 */
export function* iterateEcdictEntries(text: string): Generator<DictionaryEntryInput> {
  let columns = ECDICT_FALLBACK_COLUMNS;
  let first = true;

  for (const row of iterateCsvRows(text)) {
    if (first) {
      first = false;
      columns = resolveEcdictColumns(row);
      if (row[columns.word]?.trim().toLowerCase() === 'word') continue;
    }
    const term = normalizeVocabularyTerm(row[columns.word] ?? '');
    if (!term) continue;
    const meanings = splitMeanings(row[columns.translation] ?? '');
    if (!meanings.length) continue;
    const phoneticIndex = columns.phonetic;
    yield {
      term,
      meanings,
      phonetic: phoneticIndex >= 0 ? (row[phoneticIndex] ?? '').trim() : '',
    };
  }
}

/**
 * 自定义链接只接受应用自身的 JSON 结构：
 * `{ "<word>": { "meanings": ["…"], "phonetic": "…" } }`
 */
export function* iterateAppJsonEntries(text: string): Generator<DictionaryEntryInput> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('自定义词典不是合法的 JSON');
  }
  if (!isRecord(data) || Array.isArray(data)) {
    throw new Error('自定义词典需要一个「单词 → 释义」对象');
  }
  for (const [rawTerm, value] of Object.entries(data)) {
    const term = normalizeVocabularyTerm(rawTerm);
    if (!term) continue;
    if (!isRecord(value)) continue;
    const meanings = Array.isArray(value.meanings)
      ? value.meanings
          .filter((meaning): meaning is string => typeof meaning === 'string')
          .map((meaning) => meaning.trim())
          .filter(Boolean)
      : [];
    if (!meanings.length) continue;
    yield {
      term,
      meanings,
      phonetic: typeof value.phonetic === 'string' ? value.phonetic.trim() : '',
    };
  }
}
