export const ENGLISH_LEARNING_TIMEOUT_MS = 90_000;
export const ENGLISH_LEARNING_MAX_TEXT_LENGTH = 20_000;

export function countEnglishWords(text: string): number {
  return text.match(/[A-Za-z]+(?:['’\u2010-\u2014-][A-Za-z]+)*/g)?.length ?? 0;
}

export function cleanVocabularyTerm(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
}

export function normalizeVocabularyTerm(text: string): string {
  return cleanVocabularyTerm(text)
    .normalize('NFKC')
    .replace(/[’‘]/g, "'")
    .replace(/[\u2010-\u2014]/g, '-')
    .toLowerCase();
}
