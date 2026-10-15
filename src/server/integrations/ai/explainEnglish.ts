import {
  ENGLISH_LEARNING_MAX_OUTPUT_TOKENS,
  ENGLISH_LEARNING_MAX_SELECTED_CHARS,
  ENGLISH_LEARNING_MAX_SENTENCES,
  ENGLISH_LEARNING_MAX_SENTENCE_CHARS,
  ENGLISH_LEARNING_TIMEOUT_MS,
  truncateForPrompt,
  truncateLearningContext,
} from '@/lib/englishLearning';
import { withConciseSuffix } from '@/lib/aiPromptDefaults';
import { createOpenAIClient } from '@/server/integrations/ai/openaiClient';
import { buildFinalOnlySystemPrompt } from '@/server/integrations/ai/deepThinking';
import { resolveEnglishLearningPrompt } from '@/server/integrations/ai/promptTemplates';
import { applyProviderThinkingConfig, extractAssistantText } from '@/server/integrations/ai/providerCompatibility';
import type { AiRuntimeConfig } from '@/server/integrations/ai/runtimeConfig';

export async function explainEnglish(input: AiRuntimeConfig & {
  userId: string;
  articleId: string;
  selectedText: string;
  sentences: string[];
  /** 选区所在段落的原文，用于语境分析；为空时退化为只讲解给出的句子。 */
  context?: string;
  prompt: string;
  /**
   * 简洁模式开关，默认 true：给系统提示词追加长度约束后缀，
   * 减少输出 token 从而缩短尾延迟。传 false 可恢复完整输出。
   */
  concise?: boolean;
  signal: AbortSignal;
}): Promise<string> {
  const client = createOpenAIClient({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    userId: input.userId,
    source: 'server/ai/explainEnglish',
    requestLabel: 'English learning request',
    context: { articleId: input.articleId },
  });
  const signal = AbortSignal.any([
    input.signal,
    AbortSignal.timeout(ENGLISH_LEARNING_TIMEOUT_MS),
  ]);
  // 性能：精读链路强制走快速通道——绕过 deepThinking（即使设置里开启了），
  // 按服务商能力关闭思考；context 截断到 1500 字；输出加 max_tokens 上限；
  // 只保留 temperature=0.2，不传 top_p/penalty，避免 provider 忽略或冲突。
  const concise = input.concise !== false;
  // 精读链路默认模型很强也要加 final-only 约束：简单语法解释不需要展示思考，
  // 这是防思维链外露的第一道防线（reasoning 通道丢弃 + 标签过滤是后两道）。
  const systemPrompt = buildFinalOnlySystemPrompt(
    withConciseSuffix(resolveEnglishLearningPrompt(input.prompt), concise),
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
      max_tokens: ENGLISH_LEARNING_MAX_OUTPUT_TOKENS,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify({
          selectedText: truncateForPrompt(input.selectedText, ENGLISH_LEARNING_MAX_SELECTED_CHARS),
          sentences: input.sentences
            .slice(0, ENGLISH_LEARNING_MAX_SENTENCES)
            .map((s) => truncateForPrompt(s, ENGLISH_LEARNING_MAX_SENTENCE_CHARS)),
          context: truncateLearningContext(input.context),
        }) },
      ],
    },
  }), { signal, timeout: ENGLISH_LEARNING_TIMEOUT_MS, maxRetries: 0 });
  // 快速阅读只接受答案正文，推理通道不作为空答案的回退。
  const text = extractAssistantText({ content: completion.choices[0]?.message?.content });
  if (!text) throw new Error('AI returned an empty explanation');
  return text;
}
