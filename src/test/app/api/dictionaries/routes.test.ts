import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionaryRecord } from '@/server/domains/dictionaries/dictionariesRepo';

const requireApiSessionMock = vi.fn();
const listDictionariesMock = vi.fn();
const lookupDictionaryTermMock = vi.fn();
const setDictionaryEnabledMock = vi.fn();
const removeDictionaryMock = vi.fn();
const startManifestInstallMock = vi.fn();
const startCustomInstallMock = vi.fn();

vi.mock('@/server/infra/db/pool', () => ({ getPool: () => ({}) }));
vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));
vi.mock('@/server/domains/dictionaries/dictionariesService', () => ({
  listDictionaries: (...args: unknown[]) => listDictionariesMock(...args),
  lookupDictionaryTerm: (...args: unknown[]) => lookupDictionaryTermMock(...args),
  setDictionaryEnabled: (...args: unknown[]) => setDictionaryEnabledMock(...args),
  removeDictionary: (...args: unknown[]) => removeDictionaryMock(...args),
}));
vi.mock('@/server/domains/dictionaries/installService', () => ({
  startManifestInstall: (...args: unknown[]) => startManifestInstallMock(...args),
  startCustomInstall: (...args: unknown[]) => startCustomInstallMock(...args),
}));

import { GET as listRoute, POST as installRoute } from '@/app/api/dictionaries/route';
import {
  DELETE as deleteRoute,
  PATCH as patchRoute,
} from '@/app/api/dictionaries/[id]/route';
import { GET as lookupRoute } from '@/app/api/dictionaries/lookup/route';

const record: DictionaryRecord = {
  id: 'ecdict-full',
  name: 'ECDICT 完整版',
  description: '',
  language: 'en-zh',
  license: 'MIT',
  attribution: '',
  homepage: '',
  sourceUrl: 'https://example.com/ecdict.csv',
  builtin: false,
  enabled: true,
  status: 'installing',
  error: '',
  totalEntries: 768_739,
  entryCount: 0,
  totalBytes: 65_936_699,
  downloadedBytes: 0,
  installedAt: null,
  updatedAt: null,
};

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/dictionaries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function readJson(response: Response) {
  return response.json() as Promise<{
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  }>;
}

beforeEach(() => {
  for (const mock of [
    requireApiSessionMock, listDictionariesMock, lookupDictionaryTermMock,
    setDictionaryEnabledMock, removeDictionaryMock, startManifestInstallMock,
    startCustomInstallMock,
  ]) mock.mockReset();
  requireApiSessionMock.mockResolvedValue({ userId: '1', role: 'admin', sessionVersion: 1 });
});

describe('GET /api/dictionaries', () => {
  it('返回词典列表', async () => {
    listDictionariesMock.mockResolvedValue([{ id: 'builtin' }]);
    const response = await listRoute();

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true, data: { items: [{ id: 'builtin' }] } });
  });

  it('未登录时返回 401', async () => {
    requireApiSessionMock.mockResolvedValue({
      response: Response.json({ ok: false, error: { code: 'unauthorized', message: '请先登录' } }, { status: 401 }),
    });
    const response = await listRoute();
    expect(response.status).toBe(401);
  });
});

describe('POST /api/dictionaries', () => {
  it('管理员可以开始安装目录中的词典', async () => {
    startManifestInstallMock.mockResolvedValue(record);
    const response = await installRoute(jsonRequest({ id: 'ecdict-full' }));

    expect(response.status).toBe(202);
    expect(startManifestInstallMock).toHaveBeenCalledWith({}, 'ecdict-full');
    const payload = await readJson(response);
    expect(payload.data?.item).toMatchObject({ id: 'ecdict-full', status: 'installing' });
  });

  it('普通成员不能安装词典', async () => {
    requireApiSessionMock.mockResolvedValue({ userId: '2', role: 'member', sessionVersion: 1 });
    const response = await installRoute(jsonRequest({ id: 'ecdict-full' }));

    expect(response.status).toBe(403);
    expect(startManifestInstallMock).not.toHaveBeenCalled();
  });

  it('参数不合法时返回 400', async () => {
    const response = await installRoute(jsonRequest({ id: 'BAD ID' }));
    expect(response.status).toBe(400);
  });

  it('自定义链接指向内网时被拒绝', async () => {
    const response = await installRoute(jsonRequest({ sourceUrl: 'http://127.0.0.1/dict.json' }));
    expect(response.status).toBe(400);
    expect(startCustomInstallMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/dictionaries/[id]', () => {
  it('管理员可以停用词典', async () => {
    setDictionaryEnabledMock.mockResolvedValue({ id: 'ecdict-full', enabled: false });
    const response = await patchRoute(jsonRequest({ enabled: false }), context('ecdict-full'));

    expect(response.status).toBe(200);
    expect(setDictionaryEnabledMock).toHaveBeenCalledWith({}, 'ecdict-full', false);
  });

  it('普通成员不能修改词典', async () => {
    requireApiSessionMock.mockResolvedValue({ userId: '2', role: 'member', sessionVersion: 1 });
    const response = await patchRoute(jsonRequest({ enabled: false }), context('ecdict-full'));
    expect(response.status).toBe(403);
  });

  it('词典不存在时返回 404', async () => {
    setDictionaryEnabledMock.mockResolvedValue(null);
    const response = await patchRoute(jsonRequest({ enabled: false }), context('ecdict-full'));
    expect(response.status).toBe(404);
  });

  it('ID 不合法时返回 400', async () => {
    const response = await patchRoute(jsonRequest({ enabled: false }), context('BAD ID'));
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/dictionaries/[id]', () => {
  it('管理员可以删除词典', async () => {
    removeDictionaryMock.mockResolvedValue(true);
    const response = await deleteRoute(new Request('http://localhost'), context('ecdict-full'));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({ ok: true, data: { deleted: true } });
  });

  it('删除不存在的词典返回 404', async () => {
    removeDictionaryMock.mockResolvedValue(false);
    const response = await deleteRoute(new Request('http://localhost'), context('ecdict-full'));
    expect(response.status).toBe(404);
  });
});

describe('GET /api/dictionaries/lookup', () => {
  it('返回查询结果', async () => {
    lookupDictionaryTermMock.mockResolvedValue({
      status: 'found',
      dictionaryId: 'ecdict-full',
      entry: { meanings: ['保险丝'], phonetic: 'fju:z' },
    });
    const response = await lookupRoute(new Request('http://localhost/api/dictionaries/lookup?term=Fuse'));

    expect(response.status).toBe(200);
    expect(lookupDictionaryTermMock).toHaveBeenCalledWith({}, 'Fuse');
    expect((await readJson(response)).data?.result).toMatchObject({ status: 'found' });
  });

  it('缺少查询词时返回 400', async () => {
    const response = await lookupRoute(new Request('http://localhost/api/dictionaries/lookup'));
    expect(response.status).toBe(400);
  });

  it('普通成员也可以查词', async () => {
    requireApiSessionMock.mockResolvedValue({ userId: '2', role: 'member', sessionVersion: 1 });
    lookupDictionaryTermMock.mockResolvedValue({ status: 'not_found' });
    const response = await lookupRoute(new Request('http://localhost/api/dictionaries/lookup?term=fuse'));
    expect(response.status).toBe(200);
  });
});
