import { requireApiSession } from '@/server/domains/auth/services/session';
import {
  customDictionaryInstallSchema,
  dictionaryInstallSchema,
} from '@/server/domains/dictionaries/inputSchema';
import { listDictionaries } from '@/server/domains/dictionaries/dictionariesService';
import {
  startCustomInstall,
  startManifestInstall,
} from '@/server/domains/dictionaries/installService';
import { buildRecordSummary } from '@/server/domains/dictionaries/summary';
import { getPool } from '@/server/infra/db/pool';
import { ok, fail } from '@/server/infra/http/apiResponse';
import { ForbiddenError, ValidationError } from '@/server/infra/http/errors';
import { inputErrorFields } from '@/server/domains/english-learning/inputSchema';
import { isSafeExternalUrl } from '@/server/integrations/rss/ssrfGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 词典是实例级共享资源，安装与删除只允许管理员执行。 */
async function requireAdminSession() {
  const session = await requireApiSession();
  if ('response' in session) return session;
  if (session.role !== 'admin') return { response: fail(new ForbiddenError('仅管理员可以管理词典')) };
  return session;
}

export async function GET() {
  const session = await requireApiSession();
  if ('response' in session) return session.response;
  try {
    return ok({ items: await listDictionaries(getPool()) });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if ('response' in session) return session.response;
  try {
    const body: unknown = await request.json().catch(() => null);
    const manifest = dictionaryInstallSchema.safeParse(body);
    if (manifest.success) {
      const record = await startManifestInstall(getPool(), manifest.data.id);
      return ok({ item: buildRecordSummary(record) }, { status: 202 });
    }
    const custom = customDictionaryInstallSchema.safeParse(body);
    if (!custom.success) {
      return fail(new ValidationError('词典参数不正确', inputErrorFields(custom.error)));
    }
    if (!(await isSafeExternalUrl(custom.data.sourceUrl))) {
      return fail(new ValidationError('该链接不允许访问', {
        sourceUrl: '无法访问该地址；如需从内网下载，请调整 RSS_NETWORK_MODE 后重试',
      }));
    }
    const record = await startCustomInstall(getPool(), custom.data.sourceUrl);
    return ok({ item: buildRecordSummary(record) }, { status: 202 });
  } catch (error) {
    return fail(error);
  }
}
