import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENGLISH_LEARNING_PROMPT, DEFAULT_WORD_DETAIL_PROMPT } from '@/lib/aiPromptDefaults';

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

describe('explainWordDetail', () => {
  beforeEach(() => {
    createOpenAIClientMock.mockReset();
    createCompletionMock.mockReset();
  });

  it('使用固定的详细解释提示词，不与句子讲解提示词混用', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '此处表示“很快地”。' } }],
    });

    const { explainWordDetail } = await import('@/server/integrations/ai/explainWordDetail');
    const out = await explainWordDetail({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      deepThinkingEnabled: false,
      userId: 'user-1',
      articleId: 'article-1',
      term: 'quickly',
      selectedText: 'uing quickl',
      sentences: ['The team kept arguing quickly.'],
      context: 'The team kept arguing quickly during the meeting.',
      signal: new AbortController().signal,
    });

    const request = createCompletionMock.mock.calls[0]?.[0];
    const systemPrompt = request?.messages?.[0]?.content;
    const userPayload = JSON.parse(String(request?.messages?.[1]?.content));

    expect(out).toBe('此处表示“很快地”。');
    expect(createOpenAIClientMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'server/ai/explainWordDetail' }),
    );
    expect(systemPrompt).toContain(DEFAULT_WORD_DETAIL_PROMPT);
    expect(systemPrompt).not.toContain(DEFAULT_ENGLISH_LEARNING_PROMPT);
    expect(systemPrompt).not.toContain('英语精读助手');
    expect(userPayload).toEqual({
      term: 'quickly',
      selectedText: 'uing quickl',
      sentences: ['The team kept arguing quickly.'],
      context: 'The team kept arguing quickly during the meeting.',
    });
  });

  it('没有语境时发送空字符串而不是省略字段', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '讲解' } }],
    });

    const { explainWordDetail } = await import('@/server/integrations/ai/explainWordDetail');
    await explainWordDetail({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      deepThinkingEnabled: false,
      userId: 'user-1',
      articleId: 'article-1',
      term: 'quickly',
      selectedText: 'quickly',
      sentences: ['quickly'],
      signal: new AbortController().signal,
    });

    const request = createCompletionMock.mock.calls[0]?.[0];
    const userPayload = JSON.parse(String(request?.messages?.[1]?.content));
    expect(userPayload.context).toBe('');
  });

  it('AI 返回空内容时抛错', async () => {
    createCompletionMock.mockResolvedValue({ choices: [{ message: { content: '', reasoning_content: '内部思考不能当作详细解释' } }] });
    const { explainWordDetail } = await import('@/server/integrations/ai/explainWordDetail');

    await expect(explainWordDetail({
      apiBaseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      deepThinkingEnabled: false,
      userId: 'user-1',
      articleId: 'article-1',
      term: 'quickly',
      selectedText: 'quickly',
      sentences: ['quickly'],
      signal: new AbortController().signal,
    })).rejects.toThrow('AI returned an empty word detail');
  });
});
