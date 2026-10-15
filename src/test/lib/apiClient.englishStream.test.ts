import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, canFallbackEnglishStream, streamEnglishExplanation } from '@/lib/api/apiClient';

const body = { selectedText: 'kept arguing about the plan', sentences: ['They kept arguing about the plan.'], context: '' };
const encode = (event: string, data: unknown) => new TextEncoder().encode(
  `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`,
);

afterEach(() => vi.unstubAllGlobals());

describe('English learning stream', () => {
  it('正文到达即回调，不必等 done；CRLF 和跨数据块中文均正确解析', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const onDelta = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(value) { controller = value; },
    }), { headers: { 'content-type': 'text/event-stream' } })));
    const pending = streamEnglishExplanation('1', body, new AbortController().signal, { onDelta });
    await vi.waitFor(() => expect(controller).toBeDefined());
    const bytes = encode('learning.delta', { delta: '这是一句译文。' });
    // 每个字节单独到达，覆盖 UTF-8 及 CRLF 在 chunk 边界截断。
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    await vi.waitFor(() => expect(onDelta).toHaveBeenCalledWith('这是一句译文。'));
    controller.enqueue(encode('learning.done', { explanation: '这是一句译文。' }));
    controller.close();
    expect(await pending).toEqual({ explanation: '这是一句译文。' });
  });

  it('正文后中途 EOF 不会当作完整答案缓存', async () => {
    const onDelta = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encode('learning.delta', { delta: '半截正文' }));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } })));
    await expect(streamEnglishExplanation('1', body, new AbortController().signal, { onDelta }))
      .rejects.toMatchObject({ code: 'incomplete_stream' });
    expect(onDelta).toHaveBeenCalledWith('半截正文');
  });

  it('上游超时事件直接透出，不转换为协议不支持', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(encode('learning.error', { code: 'timeout', message: '超时' }), {
      headers: { 'content-type': 'text/event-stream' },
    })));
    await expect(streamEnglishExplanation('1', body, new AbortController().signal))
      .rejects.toMatchObject({ code: 'timeout' });
    expect(canFallbackEnglishStream(new ApiError('超时', 'timeout'), false)).toBe(false);
  });

  it('明确不支持协议时允许一次回退，收到正文后禁止回退', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 406 })));
    await expect(streamEnglishExplanation('1', body, new AbortController().signal))
      .rejects.toMatchObject({ code: 'stream_unsupported' });
    const error = new ApiError('不支持', 'stream_unsupported');
    expect(canFallbackEnglishStream(error, false)).toBe(true);
    expect(canFallbackEnglishStream(error, true)).toBe(false);
    expect(canFallbackEnglishStream(new ApiError('限流', 'rate_limit'), false)).toBe(false);
  });

  it('旧服务直接返回 JSON 时使用已有结果，不再生成一次', async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, data: { explanation: '译文' } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await streamEnglishExplanation('1', body, new AbortController().signal)).toEqual({ explanation: '译文' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
