import { requireApiSession } from '@/server/domains/auth/services/session';
import {
  dictionaryIdSchema,
  dictionaryPatchSchema,
} from '@/server/domains/dictionaries/inputSchema';
import {
  removeDictionary,
  setDictionaryEnabled,
} from '@/server/domains/dictionaries/dictionariesService';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ForbiddenError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { inputErrorFields } from '@/server/domains/english-learning/inputSchema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string }> };

/** 词典是实例级共享资源，启用状态与删除只允许管理员执行。 */
async function requireAdminSession() {
  const session = await requireApiSession();
  if ('response' in session) return session;
  if (session.role !== 'admin') return { response: fail(new ForbiddenError('仅管理员可以管理词典')) };
  return session;
}

async function readDictionaryId(context: RouteContext): Promise<string | null> {
  const params = dictionaryIdSchema.safeParse((await context.params).id);
  return params.success ? params.data : null;
}

export async function PATCH(request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ('response' in session) return session.response;
  try {
    const id = await readDictionaryId(context);
    if (!id) return fail(new ValidationError('词典 ID 不正确', { id: '词典 ID 不正确' }));
    const parsed = dictionaryPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail(new ValidationError('词典参数不正确', inputErrorFields(parsed.error)));
    }
    const item = await setDictionaryEnabled(getPool(), id, parsed.data.enabled);
    if (!item) return fail(new NotFoundError('未找到该词典'));
    return ok({ item });
  } catch (error) {
    return fail(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const session = await requireAdminSession();
  if ('response' in session) return session.response;
  try {
    const id = await readDictionaryId(context);
    if (!id) return fail(new ValidationError('词典 ID 不正确', { id: '词典 ID 不正确' }));
    if (!(await removeDictionary(getPool(), id))) {
      return fail(new NotFoundError('未找到该词典'));
    }
    return ok({ deleted: true });
  } catch (error) {
    return fail(error);
  }
}
