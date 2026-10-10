import { ENGLISH_LEARNING_TIMEOUT_MS } from '@/lib/englishLearning';
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
  prompt: string;
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
  const completion = await client.chat.completions.create(applyProviderThinkingConfig({
    apiBaseUrl: input.apiBaseUrl,
    model: input.model,
    deepThinkingEnabled: input.deepThinkingEnabled,
    request: {
      model: input.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: buildFinalOnlySystemPrompt(
          resolveEnglishLearningPrompt(input.prompt), input.deepThinkingEnabled,
        ) },
        { role: 'user', content: JSON.stringify({
          selectedText: input.selectedText,
          sentences: input.sentences,
        }) },
      ],
    },
  }), { signal, timeout: ENGLISH_LEARNING_TIMEOUT_MS, maxRetries: 0 });
  const text = extractAssistantText(completion.choices[0]?.message);
  if (!text) throw new Error('AI returned an empty explanation');
  return text;
}
