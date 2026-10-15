import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCompletionMock = vi.hoisted(() => vi.fn());
const openAIConstructorMock = vi.hoisted(() => vi.fn());
const writeSystemLogMock = vi.hoisted(() => vi.fn());
const pool = {};

vi.mock('openai', () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: (...args: unknown[]) => createCompletionMock(...args),
      },
    };

    constructor(input: unknown) {
      openAIConstructorMock(input);
    }
  },
}));

vi.mock('@/server/infra/db/pool', () => ({
  getPool: () => pool,
}));

vi.mock('@/server/infra/logging/systemLogger', () => ({
  writeSystemLog: (...args: unknown[]) => writeSystemLogMock(...args),
}));

describe('openaiClient', () => {
  it('日志迟迟未完成也不阻塞模型响应', async () => {
    createCompletionMock.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    writeSystemLogMock.mockReturnValue(new Promise(() => {}));
    const { createOpenAIClient } = await import('@/server/integrations/ai/openaiClient');
    const client = createOpenAIClient({
      apiBaseUrl: 'https://api.deepseek.com', apiKey: 'test', source: 'test', requestLabel: 'test',
    });
    expect(await client.chat.completions.create({ model: 'deepseek-flash', messages: [] }))
      .toMatchObject({ choices: [{ message: { content: 'ok' } }] });
  });

  it('流式日志在消费结束后记录正文首字和完整耗时，而不是连接时间', async () => {
    let now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const stream = {
      async *[Symbol.asyncIterator]() {
        now = 140;
        yield { choices: [{ delta: { reasoning_content: '思考' } }] };
        now = 260;
        yield { choices: [{ delta: { content: '答案' } }] };
        now = 310;
        yield { choices: [{ delta: {}, finish_reason: 'stop' }] };
      },
    };
    createCompletionMock.mockResolvedValue(stream);
    const { createOpenAIClient } = await import('@/server/integrations/ai/openaiClient');
    const client = createOpenAIClient({
      apiBaseUrl: 'https://api.deepseek.com', apiKey: 'test', source: 'test', requestLabel: 'test',
    });
    const response = await client.chat.completions.create({ model: 'deepseek-flash', messages: [], stream: true });
    expect(writeSystemLogMock).not.toHaveBeenCalled();
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    expect(chunks).toHaveLength(3);
    expect(writeSystemLogMock).toHaveBeenCalledWith(pool, expect.objectContaining({
      context: expect.objectContaining({
        durationMs: 210, streamReadyMs: 0, firstChunkMs: 40, firstContentMs: 160, finishReason: 'stop', aborted: false,
      }),
    }));
  });

  it('日志写入失败不会丢失成功响应', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    createCompletionMock.mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    writeSystemLogMock.mockRejectedValue(new Error('database down'));
    const { createOpenAIClient } = await import('@/server/integrations/ai/openaiClient');
    const client = createOpenAIClient({
      apiBaseUrl: 'https://api.deepseek.com', apiKey: 'test', source: 'test', requestLabel: 'test',
    });
    expect(await client.chat.completions.create({ model: 'deepseek-flash', messages: [] }))
      .toMatchObject({ choices: [{ message: { content: 'ok' } }] });
  });

  beforeEach(() => {
    createCompletionMock.mockReset();
    openAIConstructorMock.mockReset();
    writeSystemLogMock.mockReset();
  });

  it('normalizes baseURL by trimming trailing slash only', async () => {
    const mod = await import('@/server/integrations/ai/openaiClient');
    expect(mod.normalizeBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1');
    expect(mod.normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });

  it('retries localhost baseURL via host.docker.internal on connection errors', async () => {
    createCompletionMock
      .mockRejectedValueOnce(new Error('Connection error.'))
      .mockResolvedValueOnce({
        choices: [{ message: { content: 'ok' } }],
      });
    const mod = await import('@/server/integrations/ai/openaiClient');

    const client = mod.createOpenAIClient({
      apiBaseUrl: 'http://localhost:8317/v1/',
      apiKey: 'sk-test',
      source: 'server/ai/streamSummarizeText',
      requestLabel: 'AI summary request',
    } as Parameters<typeof mod.createOpenAIClient>[0]);

    await expect(client.chat.completions.create({ model: 'gpt-4o-mini' })).resolves.toEqual({
      choices: [{ message: { content: 'ok' } }],
    });

    expect(openAIConstructorMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'http://localhost:8317/v1',
      }),
    );
    expect(openAIConstructorMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'http://host.docker.internal:8317/v1',
      }),
    );
    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        level: 'info',
        category: 'external_api',
        source: 'server/ai/streamSummarizeText',
        message: 'AI summary request completed',
        details: null,
        context: expect.objectContaining({
          url: 'http://host.docker.internal:8317/v1',
          method: 'POST',
          model: 'gpt-4o-mini',
          durationMs: expect.any(Number),
        }),
      }),
    );
  });

  it('wraps chat completions and writes success logs', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'ok' } }],
    });
    const mod = await import('@/server/integrations/ai/openaiClient');

    const client = mod.createOpenAIClient({
      apiBaseUrl: 'https://api.openai.com/v1/',
      apiKey: 'sk-test',
      source: 'server/ai/streamSummarizeText',
      requestLabel: 'AI summary request',
    } as Parameters<typeof mod.createOpenAIClient>[0]);

    await client.chat.completions.create({ model: 'gpt-4o-mini' });

    expect(openAIConstructorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'sk-test',
        baseURL: 'https://api.openai.com/v1',
      }),
    );
    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        level: 'info',
        category: 'external_api',
        source: 'server/ai/streamSummarizeText',
        message: 'AI summary request completed',
        details: null,
        context: expect.objectContaining({
          url: 'https://api.openai.com/v1',
          method: 'POST',
          model: 'gpt-4o-mini',
          durationMs: expect.any(Number),
        }),
      }),
    );
  });

  it('writes failure logs with details text', async () => {
    createCompletionMock.mockRejectedValue(new Error('Rate limit exceeded'));
    const mod = await import('@/server/integrations/ai/openaiClient');

    const client = mod.createOpenAIClient({
      apiBaseUrl: 'https://api.openai.com/v1/',
      apiKey: 'sk-test',
      source: 'server/ai/streamSummarizeText',
      requestLabel: 'AI summary request',
    } as Parameters<typeof mod.createOpenAIClient>[0]);

    await expect(client.chat.completions.create({ model: 'gpt-4o-mini' })).rejects.toThrow(
      'Rate limit exceeded',
    );

    expect(writeSystemLogMock).toHaveBeenCalledWith(
      pool,
      expect.objectContaining({
        level: 'error',
        category: 'external_api',
        source: 'server/ai/streamSummarizeText',
        message: 'AI summary request failed',
        details: expect.stringContaining('Rate limit exceeded'),
        context: expect.objectContaining({
          url: 'https://api.openai.com/v1',
          method: 'POST',
          model: 'gpt-4o-mini',
          durationMs: expect.any(Number),
        }),
      }),
    );
    expect(openAIConstructorMock).toHaveBeenCalledTimes(1);
  });
});
