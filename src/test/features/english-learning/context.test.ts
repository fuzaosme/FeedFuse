import { describe, expect, it } from 'vitest';
import { buildSelectionContext, SELECTION_CONTEXT_MAX_LENGTH } from '@/features/english-learning/utils/context';
import type { LearningSelection } from '@/features/english-learning/utils/selection';

function selectionWithPieces(pieces: { text: string; context: string }[]): LearningSelection {
  return {
    selectedText: pieces.map((piece) => piece.text).join('\n'),
    wordCount: 2,
    sentences: ['fixture'],
    rect: { left: 0, right: 0, top: 0, bottom: 0 },
    pieces: pieces.map((piece) => ({
      text: piece.text,
      context: piece.context,
      start: 0,
      end: piece.text.length,
    })),
  };
}

describe('buildSelectionContext', () => {
  it('按出现顺序拼接选区所在段落并压缩空白', () => {
    const context = buildSelectionContext(selectionWithPieces([
      { text: 'arguing', context: 'The team   kept\narguing quickly.' },
    ]));

    expect(context).toBe('The team kept arguing quickly.');
  });

  it('跨段选择时保留多个段落并去重相同文本块', () => {
    const context = buildSelectionContext(selectionWithPieces([
      { text: 'arguing', context: 'First paragraph.' },
      { text: 'quickly', context: 'Second paragraph.' },
      { text: 'arguing', context: 'First paragraph.' },
    ]));

    expect(context).toBe('First paragraph.\nSecond paragraph.');
  });

  it('没有文本块信息时返回空字符串', () => {
    expect(buildSelectionContext(selectionWithPieces([]))).toBe('');
  });

  it('超长段落按句末截断，不把整篇正文交给 AI', () => {
    const sentence = `${'word '.repeat(40)}end. `;
    const longBlock = sentence.repeat(30);
    const context = buildSelectionContext(selectionWithPieces([
      { text: 'word', context: longBlock },
    ]));

    expect(context.length).toBeLessThanOrEqual(SELECTION_CONTEXT_MAX_LENGTH);
    expect(context.endsWith('.')).toBe(true);
  });
});
