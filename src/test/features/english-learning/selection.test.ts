import { afterEach, describe, expect, it, vi } from 'vitest';
import { readLearningSelection } from '@/features/english-learning/utils/selection';
import { resolveLookupPlan } from '@/features/english-learning/utils/lookupTerms';

const RECT = {
  left: 10, top: 20, right: 60, bottom: 40, width: 50, height: 20, x: 10, y: 20,
  toJSON: () => ({}),
} as DOMRect;

function stubRangeRect() {
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value: () => RECT,
  });
}

function selectRange(startNode: Text, start: number, endNode: Text, end: number) {
  const range = document.createRange();
  range.setStart(startNode, start);
  range.setEnd(endNode, end);
  const selection = window.getSelection();
  if (!selection) throw new Error('no selection');
  selection.removeAllRanges();
  selection.addRange(range);
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('readLearningSelection', () => {
  it('正文链接内的单词可以查词，保留链接外的完整句子上下文', () => {
    document.body.innerHTML = '<div id="root"><p>The <a href="https://example.com"><em>proposal</em></a> fell through.</p></div>';
    const root = document.getElementById('root') as HTMLElement;
    stubRangeRect();
    const text = root.querySelector('em')!.firstChild as Text;
    selectRange(text, 0, text, 8);
    const selection = readLearningSelection(root);
    expect(selection?.selectedText).toBe('proposal');
    expect(selection?.sentences).toEqual(['The proposal fell through.']);
    expect(selection?.pieces[0].context).toBe('The proposal fell through.');
  });

  it('正文选区可以跨过链接，但仍不能包含代码', () => {
    document.body.innerHTML = '<div id="root"><p>The <a href="https://example.com">proposal</a> fell through. <code>secret</code></p></div>';
    const root = document.getElementById('root') as HTMLElement;
    stubRangeRect();
    const start = root.querySelector('p')!.firstChild as Text;
    const end = root.querySelector('a')!.nextSibling as Text;
    selectRange(start, 0, end, 14);
    expect(readLearningSelection(root)?.selectedText).toBe('The proposal fell through.');
    const code = root.querySelector('code')!.firstChild as Text;
    selectRange(start, 0, code, 6);
    expect(readLearningSelection(root)).toBeNull();
  });

  it('记录选区在文本块中的上下文和下标，便于补全被截断的单词', () => {
    document.body.innerHTML = '<div id="root"><p>arguing that</p></div>';
    const root = document.getElementById('root') as HTMLElement;
    stubRangeRect();
    const text = root.querySelector('p')!.firstChild as Text;

    selectRange(text, 3, text, 10);

    const selection = readLearningSelection(root);
    expect(selection?.selectedText).toBe('uing th');
    expect(selection?.pieces).toEqual([
      { text: 'uing th', context: 'arguing that', start: 3, end: 10 },
    ]);
    expect(resolveLookupPlan(selection!.pieces)).toEqual({ terms: ['arguing that'], fallbackTerms: ['arguing', 'that'] });
  });

  it('跨内联标签合并同一个文本块里的选区', () => {
    document.body.innerHTML = '<div id="root"><p>arguing <em>that</em></p></div>';
    const root = document.getElementById('root') as HTMLElement;
    stubRangeRect();
    const first = root.querySelector('p')!.firstChild as Text;
    const second = root.querySelector('em')!.firstChild as Text;

    selectRange(first, 3, second, 2);

    const selection = readLearningSelection(root);
    expect(selection?.selectedText).toBe('uing th');
    expect(selection?.pieces).toEqual([
      { text: 'uing th', context: 'arguing that', start: 3, end: 10 },
    ]);
    expect(resolveLookupPlan(selection!.pieces)).toEqual({ terms: ['arguing that'], fallbackTerms: ['arguing', 'that'] });
  });

  it('选区范围为零时返回 null', () => {
    document.body.innerHTML = '<div id="root"><p>arguing that</p></div>';
    const root = document.getElementById('root') as HTMLElement;
    const text = root.querySelector('p')!.firstChild as Text;

    selectRange(text, 3, text, 3);

    expect(readLearningSelection(root)).toBeNull();
  });
});

function readTextSelection(context: string, selected: string) {
  document.body.innerHTML = '<div id="root"><p></p></div>';
  const root = document.getElementById('root') as HTMLElement;
  root.querySelector('p')!.textContent = context;
  stubRangeRect();
  const text = root.querySelector('p')!.firstChild as Text;
  const start = context.indexOf(selected);
  if (start < 0) throw new Error('selection not found');
  selectRange(text, start, text, start + selected.length);
  return readLearningSelection(root);
}

describe('句子边界容错', () => {
  const main = 'The team changed its plan.';
  const next = 'Investors welcomed the new decision.';

  it.each(['I', 'Investors', 'Investors w', 'Investors welcomed'])('主句之后最多两个词的越界会被去除：%s', (fringe) => {
    const value = readTextSelection(`${main} ${next}`, `${main} ${fringe}`);
    expect(value?.sentences).toEqual([main]);
    expect(value?.selectedText).toBe(main);
    expect(value?.wordCount).toBe(5);
    expect(value?.pieces[0].context).toBe(`${main} ${next}`);
  });

  it('第三个词哪怕只碰到一个字母也保留跨句选区', () => {
    const value = readTextSelection(`${main} ${next}`, `${main} Investors welcomed t`);
    expect(value?.sentences).toEqual([main, next]);
    expect(value?.selectedText).toBe(`${main} Investors welcomed t`);
  });

  it('前一句末尾最多两个词的越界同样去除', () => {
    const value = readTextSelection(`${next} ${main}`, `new decision. ${main}`);
    expect(value?.sentences).toEqual([main]);
    expect(value?.selectedText).toBe(main);
    expect(value?.pieces[0].start).toBe(next.length + 1);
  });

  it.each(['I agree.', 'Go.'])('完整选中的短句不能因为词数少被去除：%s', (short) => {
    const value = readTextSelection(`${main} ${short}`, `${main} ${short}`);
    expect(value?.sentences).toEqual([main, short]);
    expect(value?.selectedText).toBe(`${main} ${short}`);
  });

  it('两句都只选中一部分时不擅自裁边', () => {
    const selected = 'its plan. Investors welcomed';
    const value = readTextSelection(`${main} ${next}`, selected);
    expect(value?.sentences).toEqual([main, next]);
    expect(value?.selectedText).toBe(selected);
  });

  it('单句中间的片段仍取得完整原句，原始选文不被扩为整句', () => {
    const value = readTextSelection(main, 'changed its');
    expect(value?.sentences).toEqual([main]);
    expect(value?.selectedText).toBe('changed its');
  });

  it('跨段落的越界会同步修正选文和上下文片段', () => {
    document.body.innerHTML = `<div id="root"><p>${main}</p><p>${next}</p></div>`;
    const root = document.getElementById('root') as HTMLElement;
    stubRangeRect();
    const paragraphs = root.querySelectorAll('p');
    selectRange(paragraphs[0].firstChild as Text, 0, paragraphs[1].firstChild as Text, 18);
    const value = readLearningSelection(root);
    expect(value?.sentences).toEqual([main]);
    expect(value?.selectedText).toBe(main);
    expect(value?.pieces).toHaveLength(1);
  });

  it('缺少句子分割能力时保守保留段落，不能按词数吞掉内容', () => {
    vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
    const value = readTextSelection(`${main} ${next}`, `${main} I`);
    expect(value?.sentences).toEqual([`${main} ${next}`]);
    expect(value?.selectedText).toBe(`${main} I`);
  });
});
