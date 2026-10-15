import {
  ENGLISH_LEARNING_MAX_SELECTED_CHARS,
  ENGLISH_LEARNING_MAX_SENTENCES,
  ENGLISH_LEARNING_MAX_SENTENCE_CHARS,
  ENGLISH_LEARNING_TIMEOUT_MS,
  WORD_DETAIL_MAX_OUTPUT_TOKENS,
  truncateForPrompt,
  truncateLearningContext,
} from '@/lib/englishLearning';
import { DEFAULT_WORD_DETAIL_PROMPT, withConciseSuffix } from '@/lib/aiPromptDefaults';
import { createOpenAIClient } from '@/server/integrations/ai/openaiClient';
import { buildFinalOnlySystemPrompt } from '@/server/integrations/ai/deepThinking';
import { applyProviderThinkingConfig, extractAssistantText } from '@/server/integrations/ai/providerCompatibility';
import type { AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';

/**
 * 单词「详细解释」：词典释义读不懂时的一次性深挖。
 *
 * 这里刻意固定使用 DEFAULT_WORD_DETAIL_PROMPT，既不读取设置里的句子讲解提示词，
 * 也不接受用户自定义，避免两种讲解风格互相污染。
 *
 * 性能：与句子讲解链路一致，强制走快速通道（绕过 deepThinking、
 * 按服务商能力关闭思考）、context 截断 1500 字、max_tokens 上限、
 * 只保留 temperature=0.2。
 */
export async function explainWordDetail(input: AiRuntimeConfig & {
  userId: string;
  articleId: string;
  term: string;
  selectedText: string;
  sentences: string[];
  /** 选区所在段落的原文，用于判断该词在此处的特殊用法。 */
  context?: string;
  /**
   * 简洁模式开关，默认 true。传 false 可恢复完整输出。
   */
  concise?: boolean;
  signal: AbortSignal;
}): Promise<string> {
  const client = createOpenAIClient({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    userId: input.userId,
    source: 'server/ai/explainWordDetail',
    requestLabel: 'Word detail request',
    context: { articleId: input.articleId },
  });
  const signal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(ENGLISH_LEARNING_TIMEOUT_MS),
  ]);
  const concise = input.concise !== false;
  // 与句子讲解一致：强制 final-only，思维链只走服务端过滤、绝不展示。
  const systemPrompt = buildFinalOnlySystemPrompt(
    withConciseSuffix(DEFAULT_WORD_DETAIL_PROMPT, concise),
    true,
    true,
  );
  const completion = await client.chat.completions.create(applyProviderThinkingConfig({
    apiBaseUrl: input.apiBaseUrl,
    model: input.model,
    deepThinkingEnabled: false,
    forceFast: true,
    request: {
      model: input.model,
      temperature: 0.2,
      max_tokens: WORD_DETAIL_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({
          term: input.term,
          selectedText: truncateForPrompt(input.selectedText, ENGLISH_LEARNING_MAX_SELECTED_CHARS),
          sentences: input.sentences
            .slice(0, ENGLISH_LEARNING_MAX_SENTENCES)
            .map((s) => truncateForPrompt(s, ENGLISH_LEARNING_MAX_SENTENCE_CHARS)),
          context: truncateLearningContext(input.context),
        }) },
      ],
    },
  }), { signal, timeout: ENGLISH_LEARNING_TIMEOUT_MS, maxRetries: 0 });
  const text = extractAssistantText({ content: completion.choices[0]?.message?.content });
  if (!text) throw new Error('AI returned an empty word detail');
  return text;
}
