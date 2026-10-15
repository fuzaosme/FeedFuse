/**
 * 精读链路单次请求超时：简单语法解释对如今的大模型很轻松，不需要长思考。
 * 超时直接结束，只对明确不支持流式协议的旧服务做一次兼容回退。
 */
export const ENGLISH_LEARNING_TIMEOUT_MS = 30_000;
/** 快速阅读策略更新后，不复用热更新前的旧讲解。 */
export const ENGLISH_LEARNING_CACHE_VERSION = 2;
export const ENGLISH_LEARNING_MAX_TEXT_LENGTH = 20_000;

/**
 * 性能优化：精读链路发送给模型的语境上限。
 * 路由层仍允许最长 20_000 字（兼容旧客户端），但实际请求前截断到 1500 字，
 * 避免整段长文推高首 token 耗时与费用。
 */
export const ENGLISH_LEARNING_MAX_CONTEXT_CHARS = 1500;
/** 精读链路单次最多发送的句子数，防止超长选区拖慢请求。 */
export const ENGLISH_LEARNING_MAX_SENTENCES = 8;
/** 每句发送上限（字符），超出截断并保留省略标记。 */
export const ENGLISH_LEARNING_MAX_SENTENCE_CHARS = 500;
/** 选区文本发送上限（字符）。 */
export const ENGLISH_LEARNING_MAX_SELECTED_CHARS = 1000;
/** 精读讲解输出 token 上限：简单语法解释不需要长篇，短输出=更快尾延迟+更少费用。 */
export const ENGLISH_LEARNING_MAX_OUTPUT_TOKENS = 600;
/** 单词详细解释输出 token 上限（输出更短，给更小上限）。 */
export const WORD_DETAIL_MAX_OUTPUT_TOKENS = 500;

/** 按字符截断，保留省略标记，避免 JSON 负载过大。 */
export function truncateForPrompt(text: string, maxChars: number): string {
  const value = text.trim();
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars).trimEnd()}…（已截断）`;
}

/** 语境截断：精读链路统一走这里，保证请求体可控。 */
export function truncateLearningContext(context: string | undefined): string {
  if (!context) return '';
  return truncateForPrompt(context, ENGLISH_LEARNING_MAX_CONTEXT_CHARS);
}

export function englishWordSpans(text: string): { word: string; start: number; end: number }[] {
  return [...text.matchAll(/[A-Za-z]+(?:['’‘\u2010\u2011-][A-Za-z]+)*/g)].map((match) => ({
    word: match[0], start: match.index, end: match.index + match[0].length,
  }));
}

export function countEnglishWords(text: string): number {
  return englishWordSpans(text).length;
}

const S_CONTRACTIONS = new Set([
  "it's", "he's", "she's", "that's", "there's", "here's", "what's", "who's",
  "where's", "when's", "why's", "how's", "let's",
]);

/** 查词时去掉名词所有格；常见 's 缩写仍保留，避免把 it's 查成 it。 */
export function vocabularyLookupWord(word: string): string {
  const normalized = word.replace(/[’‘]/g, "'").toLowerCase();
  return S_CONTRACTIONS.has(normalized) ? word : word.replace(/['’‘]s$/i, '');
}

/** 候选必须保留整个表达，不能把只命中前半段伪装成词组命中。 */
export function dictionaryLookupCandidates(normalized: string): string[] {
  if (!normalized) return [];
  const candidates = [normalized];
  if (englishWordSpans(normalized).length === 1) candidates.push(vocabularyLookupWord(normalized));
  if (/[ -]/.test(normalized)) {
    candidates.push(normalized.includes('-') ? normalized.replace(/-/g, ' ') : normalized.replace(/ /g, '-'));
  }
  return [...new Set(candidates)];
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
