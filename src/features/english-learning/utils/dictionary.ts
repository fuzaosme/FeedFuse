import { normalizeVocabularyTerm } from '@/lib/englishLearning';
import { isRecord } from '@/lib/utils';

export interface DictionaryEntry {
  meanings: string[];
  phonetic?: string;
}

export type DictionaryResult =
  | { status: 'found'; entry: DictionaryEntry }
  | { status: 'unconfigured' | 'not_found' | 'error' };

let dictionaryPromise: Promise<Map<string, DictionaryEntry>> | null = null;

function loadDictionary(): Promise<Map<string, DictionaryEntry>> {
  if (dictionaryPromise) return dictionaryPromise;
  dictionaryPromise = (async () => {
    const response = await fetch('/dictionaries/en-zh.json');
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
      entries.set(normalizeVocabularyTerm(term), {
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

export async function lookupDictionary(term: string): Promise<DictionaryResult> {
  try {
    const dictionary = await loadDictionary();
    if (!dictionary.size) return { status: 'unconfigured' };
    const entry = dictionary.get(normalizeVocabularyTerm(term));
    return entry ? { status: 'found', entry } : { status: 'not_found' };
  } catch {
    return { status: 'error' };
  }
}
