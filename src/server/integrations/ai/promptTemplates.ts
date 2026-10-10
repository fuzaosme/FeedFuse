import { buildFinalOnlySystemPrompt } from '@/server/integrations/ai/deepThinking';

export const DEFAULT_SUMMARY_PROMPT =
  '你是中文摘要助手。请输出简洁中文摘要：先给 1-2 句总结，再给 3-5 条要点。不要返回“TL;DR：”或类似前缀。';

export const DEFAULT_TRANSLATION_PROMPT =
  '你是翻译助手。请将用户提供的内容翻译为简体中文（zh-CN），忠于原文，不要补充原文中不存在的信息。';

export const DEFAULT_ENGLISH_LEARNING_PROMPT =
  '你是英语阅读学习助手。请用简体中文帮助用户理解提供的完整英文句子，重点关注用户选中的表达。' +
  '先给出忠于原文的自然译文，再按需要简要拆解句子结构、解释重点单词或词组。' +
  '如果提供了多个句子，请按原文顺序逐句讲解，并在必要时说明句间关系。' +
  '保持简洁，不编造上下文，不必对简单句机械地展开全部语法。输出可直接阅读的文本，用换行组织内容。';

// 统一处理用户可编辑提示词：空值时回退到内置默认模板。
function normalizePrompt(input: string | undefined, fallback: string): string {
  const trimmed = input?.trim() ?? '';
  return trimmed || fallback;
}

export function resolveSummaryPrompt(input: string | undefined): string {
  return normalizePrompt(input, DEFAULT_SUMMARY_PROMPT);
}

export function resolveEnglishLearningPrompt(input: string | undefined): string {
  return normalizePrompt(input, DEFAULT_ENGLISH_LEARNING_PROMPT);
}

export function buildTranslationSystemPrompt(input: {
  basePrompt: string | undefined;
  taskInstruction: string;
  deepThinkingEnabled?: boolean;
}): string {
  const normalized = normalizePrompt(input.basePrompt, DEFAULT_TRANSLATION_PROMPT);
  return buildFinalOnlySystemPrompt(
    `${normalized}\n\n${input.taskInstruction}`,
    Boolean(input.deepThinkingEnabled),
  );
}
