import { requireApiSession } from '@/server/domains/auth/services/session';
import { getArticleById } from '@/server/domains/articles/repositories/articlesRepo';
import { englishLearningSchema, inputErrorFields } from '@/server/domains/english-learning/inputSchema';
import { getAiApiKey, getUiSettings } from '@/server/domains/settings/repositories/settingsRepo';
import { normalizePersistedSettings } from '@/features/settings/settingsSchema';
import { explainEnglish } from '@/server/integrations/ai/explainEnglish';
import { isAiRuntimeConfigComplete, resolveSharedAiConfig } from '@/server/integrations/ai/runtimeConfig';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { AppError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';
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
import { buildFinalOnlySystemPrompt, createThinkingDeltaFilter } from '@/server/integrations/ai/deepThinking';
import { resolveEnglishLearningPrompt } from '@/server/integrations/ai/promptTemplates';
import { applyProviderThinkingConfig, extractStreamTextDelta } from '@/server/integrations/ai/providerCompatibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const LEARNING_STREAM_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  'x-accel-buffering': 'no',
} as const;

function isStreamRequest(request: Request): boolean {
  try {
    if (new URL(request.url).searchParams.get('stream') === '1') return true;
  } catch {
    // URL 解析失败时退化为只看 Accept 头。
  }
  return request.headers.get('accept')?.includes('text/event-stream') ?? false;
}

function encodeSse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * SSE 流式讲解：与非流式链路共用同一套快速通道配置
 * （按服务商能力关闭思考、绕过 deepThinking、max_tokens 上限、context 截断 1500 字、
 * temperature 0.2），只是把 `stream` 打开并把增量 delta 逐个推送给前端，
 * 让首字不必等整段生成完就能渲染。
 */
function streamExplanationResponse(input: {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  userId: string;
  articleId: string;
  selectedText: string;
  sentences: string[];
  context: string;
  prompt: string;
  signal: AbortSignal;
  preparationMs: number;
}): Response {
  const encoder = new TextEncoder();
  // 流式与非流式共用同一套约束：final-only 必须开启，防思维链外露。
  const systemPrompt = buildFinalOnlySystemPrompt(
    withConciseSuffix(resolveEnglishLearningPrompt(input.prompt), true),
    true,
    true,
  );
  const userContent = JSON.stringify({
    selectedText: truncateForPrompt(input.selectedText, ENGLISH_LEARNING_MAX_SELECTED_CHARS),
    sentences: input.sentences
      .slice(0, ENGLISH_LEARNING_MAX_SENTENCES)
      .map((s) => truncateForPrompt(s, ENGLISH_LEARNING_MAX_SENTENCE_CHARS)),
    context: truncateLearningContext(input.context),
  });
  const client = createOpenAIClient({
    apiBaseUrl: input.apiBaseUrl,
    apiKey: input.apiKey,
    userId: input.userId,
    source: 'server/ai/explainEnglish',
    requestLabel: 'English learning stream request',
    context: { articleId: input.articleId, preparationMs: input.preparationMs },
  });
  const { apiBaseUrl, model } = input;
  const streamAbort = new AbortController();
  const signal = AbortSignal.any([input.signal, streamAbort.signal, AbortSignal.timeout(ENGLISH_LEARNING_TIMEOUT_MS)]);
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(encodeSse(event, data)));
      };
      try {
        // 首包立即 flush：让客户端确认流已建立，体感首字时间只取决于上游首 token。
        controller.enqueue(encoder.encode(': stream start\n\n'));
        const completion = await client.chat.completions.create(applyProviderThinkingConfig({
          apiBaseUrl,
          model,
          deepThinkingEnabled: false,
          forceFast: true,
          request: {
            model,
            temperature: 0.2,
            max_tokens: ENGLISH_LEARNING_MAX_OUTPUT_TOKENS,
            stream: true,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userContent },
            ],
          },
        }), { signal, timeout: ENGLISH_LEARNING_TIMEOUT_MS, maxRetries: 0 });
        const filter = createThinkingDeltaFilter();
        for await (const chunk of completion) {
          signal.throwIfAborted();
          const delta = filter.push(extractStreamTextDelta(chunk));
          if (delta) send('learning.delta', { delta });
        }
        if (!signal.aborted) {
          send('learning.done', { explanation: filter.getVisibleText() });
        }
      } catch (error) {
        if (input.signal.aborted || streamAbort.signal.aborted) return;
        const message = error instanceof Error && /timeout|timed out/i.test(`${error.name} ${error.message}`)
          ? '讲解请求已取消或超时，请重试'
          : '暂时无法生成讲解，请检查 AI 配置后重试';
        const code = error instanceof Error && /timeout|timed out/i.test(`${error.name} ${error.message}`)
          ? 'timeout'
          : 'ai_request_failed';
        send('learning.error', { code, message });
      } finally {
        try {
          controller.close();
        } catch {
          // 客户端已断开时关闭流会抛错，忽略即可。
        }
      }
    },
    cancel() {
      streamAbort.abort();
    },
  });
  return new Response(stream, { headers: LEARNING_STREAM_HEADERS });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  const session = await requireApiSession();
  if ('response' in session) return session.response;
  try {
    const params = numericIdSchema.safeParse((await context.params).id);
    if (!params.success) return fail(new ValidationError('文章 ID 不正确', inputErrorFields(params.error)));
    const parsed = englishLearningSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(new ValidationError('请缩小选区并选择完整的英文内容', inputErrorFields(parsed.error)));
    const pool = getPool();
    const article = await getArticleById(pool, params.data, session.userId);
    if (!article) return fail(new NotFoundError('未找到文章'));
    const [aiApiKey, uiSettings] = await Promise.all([
      getAiApiKey(pool, session.userId), getUiSettings(pool, session.userId),
    ]);
    const settings = normalizePersistedSettings(uiSettings);
    const config = resolveSharedAiConfig({ settings, aiApiKey });
    if (!isAiRuntimeConfigComplete(config)) {
      return fail(new AppError('请先在设置中完成 AI 模型、API 地址和密钥配置', 'missing_ai_config', 409));
    }
    if (isStreamRequest(request)) {
      return streamExplanationResponse({
        ...config,
        userId: session.userId,
        articleId: article.id,
        selectedText: parsed.data.selectedText,
        sentences: parsed.data.sentences,
        context: parsed.data.context,
        prompt: settings.ai.englishLearningPrompt,
        signal: request.signal,
        preparationMs: Date.now() - startedAt,
      });
    }
    const explanation = await explainEnglish({
      ...config,
      ...parsed.data,
      userId: session.userId,
      articleId: article.id,
      prompt: settings.ai.englishLearningPrompt,
      signal: request.signal,
    });
    return ok({ explanation });
  } catch (error) {
    if (error instanceof AppError) return fail(error);
    if (error instanceof Error && /timeout|timed out|abort/i.test(`${error.name} ${error.message}`)) {
      return fail(new AppError('讲解请求已取消或超时，请重试', 'timeout', 504));
    }
    return fail(new AppError('暂时无法生成讲解，请检查 AI 配置后重试', 'ai_request_failed', 502));
  }
}
