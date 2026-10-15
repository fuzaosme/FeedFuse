import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireApiSessionMock = vi.fn();
const getArticleByIdMock = vi.fn();
const getAiApiKeyMock = vi.fn();
const getUiSettingsMock = vi.fn();
const explainWordDetailMock = vi.fn();
const pool = {};

vi.mock('@/server/infra/db/pool', () => ({ getPool: () => pool }));
vi.mock('@/server/domains/auth/services/session', () => ({
  requireApiSession: (...args: unknown[]) => requireApiSessionMock(...args),
}));
vi.mock('@/server/domains/articles/repositories/articlesRepo', () => ({
  getArticleById: (...args: unknown[]) => getArticleByIdMock(...args),
}));
vi.mock('@/server/domains/settings/repositories/settingsRepo', () => ({
  getAiApiKey: (...args: unknown[]) => getAiApiKeyMock(...args),
  getUiSettings: (...args: unknown[]) => getUiSettingsMock(...args),
}));
vi.mock('@/server/integrations/ai/explainWordDetail', () => ({
  explainWordDetail: (...args: unknown[]) => explainWordDetailMock(...args),
}));

import { POST as wordDetailRoute } from '@/app/api/articles/[id]/english-learning/word-detail/route';

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/articles/3001/english-learning/word-detail', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

const validBody = {
  term: 'quickly',
  selectedText: 'uing quickl',
  sentences: ['The team kept arguing quickly.'],
  context: 'The team kept arguing quickly during the meeting.',
};

describe('word-detail route', () => {
  beforeEach(() => {
    requireApiSessionMock.mockReset();
    getArticleByIdMock.mockReset();
    getAiApiKeyMock.mockReset();
    getUiSettingsMock.mockReset();
    explainWordDetailMock.mockReset();
    requireApiSessionMock.mockResolvedValue({ userId: '1', role: 'admin', sessionVersion: 1 });
    getArticleByIdMock.mockResolvedValue({ id: '3001' });
    getAiApiKeyMock.mockResolvedValue('sk-test');
    getUiSettingsMock.mockResolvedValue({
      ai: { model: 'gpt-4o-mini', apiBaseUrl: 'https://api.openai.com/v1', deepThinkingEnabled: false },
    });
    explainWordDetailMock.mockResolvedValue('此处表示“很快地”。');
  });

  it('返回详细解释，并把语境透传给固定提示词的调用', async () => {
    const response = await wordDetailRoute(jsonRequest(validBody), context('3001'));
    const payload = await response.json() as { ok: boolean; data: { explanation: string } };

    expect(response.status).toBe(200);
    expect(payload.data.explanation).toBe('此处表示“很快地”。');
    expect(explainWordDetailMock).toHaveBeenCalledWith(expect.objectContaining({
      articleId: '3001',
      term: 'quickly',
      selectedText: 'uing quickl',
      sentences: ['The team kept arguing quickly.'],
      context: 'The team kept arguing quickly during the meeting.',
    }));
    // 详细解释不接受用户提示词。
    expect(explainWordDetailMock.mock.calls[0]?.[0]).not.toHaveProperty('prompt');
  });

  it('词长超过 3 个英文词时返回校验错误', async () => {
    const response = await wordDetailRoute(
      jsonRequest({ ...validBody, term: 'one two three four' }),
      context('3001'),
    );

    expect(response.status).toBe(400);
    expect(explainWordDetailMock).not.toHaveBeenCalled();
  });

  it('缺少 AI 配置时返回 missing_ai_config', async () => {
    getUiSettingsMock.mockResolvedValue({});

    const response = await wordDetailRoute(jsonRequest(validBody), context('3001'));
    const payload = await response.json() as { ok: boolean; error?: { code?: string } };

    expect(response.status).toBe(409);
    expect(payload.error?.code).toBe('missing_ai_config');
    expect(explainWordDetailMock).not.toHaveBeenCalled();
  });

  it('文章不存在时返回 404', async () => {
    getArticleByIdMock.mockResolvedValue(null);

    const response = await wordDetailRoute(jsonRequest(validBody), context('3001'));

    expect(response.status).toBe(404);
  });
});
