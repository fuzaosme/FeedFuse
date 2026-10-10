import { requireApiSession } from '@/server/domains/auth/services/session';
import { getArticleById } from '@/server/domains/articles/repositories/articlesRepo';
import { vocabularyCreateSchema, inputErrorFields } from '@/server/domains/english-learning/inputSchema';
import { listVocabulary, saveVocabulary } from '@/server/domains/english-learning/repositories/vocabularyRepo';
import { normalizeVocabularyTerm } from '@/lib/englishLearning';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireApiSession();
  if ('response' in session) return session.response;
  try {
    return ok({ items: await listVocabulary(getPool(), session.userId) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;
  try {
    const parsed = vocabularyCreateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(new ValidationError('生词格式不正确', inputErrorFields(parsed.error)));
    const pool = getPool();
    const article = await getArticleById(pool, parsed.data.articleId, session.userId);
    if (!article) return fail(new NotFoundError('未找到来源文章'));
    const entry = await saveVocabulary(pool, {
      userId: session.userId,
      term: parsed.data.term,
      normalizedTerm: normalizeVocabularyTerm(parsed.data.term),
      definition: parsed.data.definition,
      sourceArticleId: article.id,
      sourceTitle: article.titleOriginal || article.title,
      sourceUrl: article.link ?? '',
      sourceSentence: parsed.data.sourceSentence,
    });
    return ok({ entry });
  } catch (error) {
    return fail(error);
  }
}
