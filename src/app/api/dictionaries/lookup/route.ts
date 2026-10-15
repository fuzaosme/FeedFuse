import { requireApiSession } from '@/server/domains/auth/services/session';
import { dictionaryLookupQuerySchema } from '@/server/domains/dictionaries/inputSchema';
import { lookupDictionaryTerm } from '@/server/domains/dictionaries/dictionariesService';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ValidationError } from '@/server/infra/http/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const session = await requireApiSession();
  if ('response' in session) return session.response;
  try {
    const url = new URL(request.url);
    const parsed = dictionaryLookupQuerySchema.safeParse({
      term: url.searchParams.get('term') ?? '',
    });
    if (!parsed.success) {
      return fail(new ValidationError('查询词不正确', { term: '请输入要查询的单词' }));
    }
    const result = await lookupDictionaryTerm(getPool(), parsed.data.term);
    return ok({ result });
  } catch (error) {
    return fail(error);
  }
}
