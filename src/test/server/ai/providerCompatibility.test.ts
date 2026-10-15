import { describe, expect, it } from 'vitest';
import {
  applyProviderThinkingConfig,
  extractAssistantText,
  extractStreamTextDelta,
} from '@/server/integrations/ai/providerCompatibility';

describe('providerCompatibility', () => {
  it.each([true, false])('DeepSeek 快速请求显式关闭思考（全局开关 %s）', (enabled) => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl: 'https://api.deepseek.com', model: 'deepseek-flash',
      deepThinkingEnabled: enabled, forceFast: true,
      request: { model: 'deepseek-flash', temperature: 0.2, messages: [] },
    });
    expect(request.reasoning_effort).toBe('none');
    expect((request as Record<string, unknown>).thinking).toEqual({ type: 'disabled' });
    expect(request.temperature).toBe(0.2);
  });

  it('DeepSeek 普通请求关闭全局思考时也显式禁用服务商默认思考', () => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', deepThinkingEnabled: false,
      request: { model: 'deepseek-flash', messages: [] },
    });
    expect((request as Record<string, unknown>).thinking).toEqual({ type: 'disabled' });
    expect(request.reasoning_effort).toBe('none');
  });

  it.each(['https://gateway.example/v1', 'https://api.openai.com/v1'])('普通模型不收到无效推理参数：%s', (apiBaseUrl) => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl, model: 'gpt-4o-mini', deepThinkingEnabled: true, forceFast: true,
      request: { model: 'gpt-4o-mini', temperature: 0.2, messages: [] },
    });
    expect(request.reasoning_effort).toBeUndefined();
    expect((request as Record<string, unknown>).thinking).toBeUndefined();
  });

  it('OpenAI 推理模型使用支持的档位与输出上限参数', () => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl: 'https://api.openai.com/v1', model: 'gpt-5.5', deepThinkingEnabled: false, forceFast: true,
      request: { model: 'gpt-5.5', temperature: 0.2, max_tokens: 600, messages: [] },
    });
    expect(request.reasoning_effort).toBe('none');
    expect(request.temperature).toBeUndefined();
    expect(request.max_tokens).toBeUndefined();
    expect((request as Record<string, unknown>).max_completion_tokens).toBe(600);
  });

  it('百炼快速请求使用自己的非思考开关', () => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-flash',
      deepThinkingEnabled: true, forceFast: true, request: { model: 'qwen-flash', messages: [] },
    });
    expect((request as Record<string, unknown>).enable_thinking).toBe(false);
    expect(request.reasoning_effort).toBeUndefined();
  });

  it('adds DeepSeek thinking payload and strips unsupported sampling knobs', () => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v4-pro',
      deepThinkingEnabled: true,
      request: {
        model: 'deepseek-v4-pro',
        temperature: 0.2,
        top_p: 0.9,
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(request.reasoning_effort).toBe('high');
    expect((request as Record<string, unknown>).thinking).toEqual({ type: 'enabled' });
    expect(request.temperature).toBeUndefined();
    expect(request.top_p).toBeUndefined();
  });

  it('keeps OpenAI requests on reasoning_effort only', () => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5.5',
      deepThinkingEnabled: true,
      request: {
        model: 'gpt-5.5',
        temperature: 0.2,
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(request.reasoning_effort).toBe('high');
    expect((request as Record<string, unknown>).thinking).toBeUndefined();
    expect(request.temperature).toBe(0.2);
  });

  it('does not treat non-DeepSeek hosts as DeepSeek just because the model name matches', () => {
    const request = applyProviderThinkingConfig({
      apiBaseUrl: 'https://openrouter.ai/api/v1',
      model: 'deepseek-v4-pro',
      deepThinkingEnabled: true,
      request: {
        model: 'deepseek-v4-pro',
        temperature: 0.2,
        top_p: 0.9,
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    // 只有原生 DeepSeek host 才需要私有 thinking 参数。
    expect(request.reasoning_effort).toBe('high');
    expect((request as Record<string, unknown>).thinking).toBeUndefined();
    expect(request.temperature).toBe(0.2);
    expect(request.top_p).toBe(0.9);
  });

  it('prefers content but falls back to reasoning_content when content is blank', () => {
    expect(
      extractAssistantText({ content: '最终答案', reasoning_content: '思考过程' }),
    ).toBe('最终答案');
    expect(
      extractAssistantText({
        content: '   ',
        reasoning_content: '<think>分析</think>最终答案',
      }),
    ).toBe('最终答案');
  });

  it('reads streaming content and ignores reasoning-only deltas', () => {
    expect(
      extractStreamTextDelta({
        choices: [{ delta: { reasoning_content: '先分析' } }],
      }),
    ).toBe('');
    expect(
      extractStreamTextDelta({
        choices: [{ delta: { content: '最终答案' } }],
      }),
    ).toBe('最终答案');
  });

  it('同一 delta 里 content 与 reasoning_content 混排时只取正文', () => {
    expect(
      extractStreamTextDelta({
        choices: [{ delta: { content: '最终答案', reasoning_content: '先分析再作答' } }],
      }),
    ).toBe('最终答案');
  });
});
