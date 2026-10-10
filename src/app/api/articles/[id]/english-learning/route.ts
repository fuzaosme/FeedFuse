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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
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
