import { buildFinalOnlySystemPrompt } from '@/server/integrations/ai/deepThinking';
import {
  DEFAULT_ENGLISH_LEARNING_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_TRANSLATION_PROMPT,
  resolvePromptOrDefault,
} from '@/lib/aiPromptDefaults';

// 默认模板定义在 @/lib/aiPromptDefaults：设置中心的「内置默认提示词」预览与服务端调用共用同一份文本。
export {
  DEFAULT_ENGLISH_LEARNING_PROMPT,
  DEFAULT_SUMMARY_PROMPT,
  DEFAULT_TRANSLATION_PROMPT,
  DEFAULT_WORD_DETAIL_PROMPT,
} from '@/lib/aiPromptDefaults';

export function resolveSummaryPrompt(input: string | undefined): string {
  return resolvePromptOrDefault(input, DEFAULT_SUMMARY_PROMPT);
}

export function resolveEnglishLearningPrompt(input: string | undefined): string {
  return resolvePromptOrDefault(input, DEFAULT_ENGLISH_LEARNING_PROMPT);
}

export function buildTranslationSystemPrompt(input: {
  basePrompt: string | undefined;
  taskInstruction: string;
  deepThinkingEnabled?: boolean;
}): string {
  const normalized = resolvePromptOrDefault(input.basePrompt, DEFAULT_TRANSLATION_PROMPT);
  return buildFinalOnlySystemPrompt(
    `${normalized}\n\n${input.taskInstruction}`,
    Boolean(input.deepThinkingEnabled),
  );
}
