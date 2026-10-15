import { beforeEach, describe, expect, it, vi } from 'vitest';

const createOpenAIClientMock = vi.hoisted(() => vi.fn());
const createCompletionMock = vi.hoisted(() => vi.fn());

vi.mock('@/server/integrations/ai/openaiClient', () => ({
  createOpenAIClient: (...args: unknown[]) => {
    createOpenAIClientMock(...args);
    return {
      chat: {
        completions: {
          create: createCompletionMock,
        },
      },
    };
  },
}));

describe('explainEnglish', () => {
  beforeEach(() => {
    createOpenAIClientMock.mockReset();
    createCompletionMock.mockReset();
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '讲解内容' } }],
    });
  });

  it('把选区所在段落作为语境一起发送', async () => {
    const { explainEnglish } = await import('@/server/integrations/ai/explainEnglish');
    const out = await explainEnglish({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      deepThinkingEnabled: false,
      userId: 'user-1',
      articleId: 'article-1',
      selectedText: 'kept arguing about the plan',
      sentences: ['The team kept arguing about the plan for hours.'],
      context: 'The team kept arguing about the plan for hours. Nobody agreed.',
      prompt: '',
      signal: new AbortController().signal,
    });

    const request = createCompletionMock.mock.calls[0]?.[0];
    const userPayload = JSON.parse(String(request?.messages?.[1]?.content));
    expect(out).toBe('讲解内容');
    expect(userPayload.context).toBe('The team kept arguing about the plan for hours. Nobody agreed.');
  });

  it('用户自定义句子讲解提示词会覆盖内置模板', async () => {
    const { explainEnglish } = await import('@/server/integrations/ai/explainEnglish');
    await explainEnglish({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      deepThinkingEnabled: false,
      userId: 'user-1',
      articleId: 'article-1',
      selectedText: 'kept arguing about the plan',
      sentences: ['The team kept arguing about the plan for hours.'],
      context: '',
      prompt: '只给译文，不要语法。',
      signal: new AbortController().signal,
    });

    const request = createCompletionMock.mock.calls[0]?.[0];
    expect(request?.messages?.[0]?.content).toContain('只给译文，不要语法。');
    expect(request?.messages?.[0]?.content).not.toContain('英语精读助手');
  });
});
