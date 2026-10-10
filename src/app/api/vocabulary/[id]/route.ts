import { requireApiSession } from '@/server/domains/auth/services/session';
import { vocabularyUpdateSchema, inputErrorFields } from '@/server/domains/english-learning/inputSchema';
import { deleteVocabulary, updateVocabularyDefinition } from '@/server/domains/english-learning/repositories/vocabularyRepo';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { numericIdSchema } from '@/server/infra/http/idSchemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;
  try {
    const params = numericIdSchema.safeParse((await context.params).id);
    if (!params.success) return fail(new ValidationError('生词 ID 不正确', inputErrorFields(params.error)));
    const parsed = vocabularyUpdateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(new ValidationError('释义格式不正确', inputErrorFields(parsed.error)));
    const entry = await updateVocabularyDefinition(getPool(), session.userId, params.data, parsed.data.definition);
    if (!entry) return fail(new NotFoundError('未找到该生词'));
    return ok({ entry });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;
  try {
    const params = numericIdSchema.safeParse((await context.params).id);
    if (!params.success) return fail(new ValidationError('生词 ID 不正确', inputErrorFields(params.error)));
    if (!await deleteVocabulary(getPool(), session.userId, params.data)) {
      return fail(new NotFoundError('未找到该生词'));
    }
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
