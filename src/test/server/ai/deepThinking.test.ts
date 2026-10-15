import { describe, expect, it } from 'vitest';
import {
  buildFinalOnlySystemPrompt,
  createThinkingDeltaFilter,
  stripThinkingText,
} from '@/server/integrations/ai/deepThinking';

describe('stripThinkingText', () => {
  it('移除 <think>/<thinking> 完整块并保留答案', () => {
    expect(stripThinkingText('<think>让我想想</think>这是答案')).toBe('这是答案');
    expect(stripThinkingText('<thinking>分析</thinking>这是答案')).toBe('这是答案');
  });

  it('移除其它常见思考标签（reasoning/thought/analysis）', () => {
    expect(stripThinkingText('<reasoning>分析</reasoning>答案')).toBe('答案');
    expect(stripThinkingText('<thought>思考</thought>答案')).toBe('答案');
    expect(stripThinkingText('<thoughts>思考</thoughts>答案')).toBe('答案');
    expect(stripThinkingText('<analysis>分析</analysis>答案')).toBe('答案');
  });

  it('移除未闭合的思考块尾巴（流式中途的思考不外露）', () => {
    expect(stripThinkingText('答案<think>还没想完')).toBe('答案');
    expect(stripThinkingText('<think>还没想完')).toBe('');
    expect(stripThinkingText('答案<reasoning>还没想完')).toBe('答案');
  });

  it('移除 markdown thinking 代码块', () => {
    expect(stripThinkingText('```thinking\n分析\n```答案')).toBe('答案');
  });

  it('丢弃整行的思考前缀、保留正文', () => {
    expect(stripThinkingText('思考过程：先分析语境\n这是答案')).toBe('这是答案');
    expect(stripThinkingText('Thinking: analyze\n这是答案')).toBe('这是答案');
  });

  it('不含思考时原样返回（去首尾空格）', () => {
    expect(stripThinkingText('  这是答案  ')).toBe('这是答案');
  });
});

describe('createThinkingDeltaFilter', () => {
  it('思考块整体过滤、可见文本无重复无外露', () => {
    const filter = createThinkingDeltaFilter();
    const deltas = [
      filter.push('<think>让我想想</think>'),
      filter.push('这是'),
      filter.push('答案'),
      filter.push('<reasoning>补充思考</reasoning>'),
      filter.push('。'),
    ];

    expect(deltas.join('')).toBe(filter.getVisibleText());
    expect(filter.getVisibleText()).toBe('这是答案。');
    expect(deltas.join('')).not.toContain('让我想想');
    expect(deltas.join('')).not.toContain('补充思考');
  });

  it('跨 chunk 的 partial 标签不外露', () => {
    const filter = createThinkingDeltaFilter();
    const deltas = [
      filter.push('答案'),
      filter.push('<th'),
      filter.push('ink>思考</think>'),
      filter.push('继续'),
    ];

    expect(deltas.join('')).toBe('答案继续');
    expect(filter.getVisibleText()).toBe('答案继续');
  });
});

describe('buildFinalOnlySystemPrompt', () => {
  it('快速阅读不要求模型先充分思考', () => {
    const out = buildFinalOnlySystemPrompt('你是助手', true, true);
    expect(out).toContain('直接输出最终结果');
    expect(out).not.toContain('请先充分思考');
  });
  it('开启时追加 final-only 约束', () => {
    const out = buildFinalOnlySystemPrompt('你是助手', true);
    expect(out).toContain('你是助手');
    expect(out).toContain('不要输出思考过程');
  });

  it('关闭时原样返回', () => {
    expect(buildFinalOnlySystemPrompt('你是助手', false)).toBe('你是助手');
  });
});
