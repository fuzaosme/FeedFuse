import { describe, expect, it } from 'vitest';
import { emphasizeVocabulary } from '@/features/english-learning/utils/emphasizeVocabulary';
import { highlightHtmlByQuery } from '@/features/reader/utils/globalSearch';
import { readLearningSelection } from '@/features/english-learning/utils/selection';

function renderHtml(html: string, terms: string[]) {
  const root = document.createElement('div');
  root.innerHTML = emphasizeVocabulary(html, terms);
  return root;
}

function markedText(root: HTMLElement) {
  return [...root.querySelectorAll('[data-vocabulary-word]')].map((span) => span.textContent);
}

describe('生词再次出现时的正文提示', () => {
  it('忽略大小写并标记所有完整匹配，保留标点和正文', () => {
    const root = renderHtml('<p>Art, ART! article partial art2 _art art-work caféart art.</p>', ['art']);
    expect(markedText(root)).toEqual(['Art', 'ART', 'art']);
    expect(root.textContent).toBe('Art, ART! article partial art2 _art art-work caféart art.');
  });

  it('较长词组优先，并兼容多个空格、不换行空格及弯引号和连字符', () => {
    const root = renderHtml('<p>In&nbsp;spite\n of rain, don’t stop the state‑of‑the‑art work.</p>',
      ['in', 'spite', 'in spite of', "don't", 'state-of-the-art']);
    expect(markedText(root)).toEqual(['In\u00a0spite\n of', 'don’t', 'state‑of‑the‑art']);
  });

  it('引号和破折号作为标点，词内撇号仍属于单词', () => {
    const root = renderHtml('<p>“Art”, ‘art’, \'art\'; art—art. An artist’s art and state-of-the-art.</p>', ['art']);
    expect(markedText(root)).toEqual(['Art', 'art', 'art', 'art', 'art', 'art']);
    expect(markedText(renderHtml('<p>reader’s reader</p>', ['reader']))).toEqual(['reader']);
  });

  it('较长词组在单词边界处不成立时，仍匹配较短的完整生词', () => {
    const root = renderHtml('<p>state of articles</p>', ['state of art', 'state', 'articles']);
    expect(markedText(root)).toEqual(['state', 'articles']);
  });

  it('跨内联元素识别整词和词组，保留链接及作者格式', () => {
    const root = renderHtml('<p>inter<em>esting</em> <a href="https://example.com/in">in <strong>spite</strong></a> of rain.</p>',
      ['interesting', 'in spite of']);
    expect(markedText(root)).toEqual(['inter', 'esting', 'in ', 'spite', ' of']);
    expect(root.querySelector('em')?.textContent).toBe('esting');
    expect(root.querySelector('strong')?.textContent).toBe('spite');
    expect(root.querySelector('a')).toHaveAttribute('href', 'https://example.com/in');
    expect(root.textContent).toBe('interesting in spite of rain.');
  });

  it('不跨段落、换行、代码或译文拼接单词', () => {
    const root = renderHtml('<p>in</p><p>spite of</p><p>art<br>icle</p><p>inter<code>x</code>esting</p>' +
      '<pre>interesting</pre><p class="ff-translation">interesting</p>' +
      '<p data-translation>interesting</p><p hidden>interesting</p><button>interesting</button>',
    ['in spite of', 'article', 'interesting']);
    expect(markedText(root)).toEqual([]);
  });

  it('不把词的一部分当成完整词，也不匹配 HTML 属性', () => {
    const root = renderHtml('<p>inter<em>esting</em> <a href="https://example.com/art" title="art">link</a></p>',
      ['inter', 'esting', 'art']);
    expect(markedText(root)).toEqual([]);
    expect(root.querySelector('a')).toHaveAttribute('title', 'art');
  });

  it('与搜索高亮兼容，即使搜索把单词拆成多个文本节点', () => {
    const html = highlightHtmlByQuery('<p>interesting art</p>', 'rest art');
    const root = renderHtml(html, ['interesting', 'art']);
    expect(root.querySelectorAll('mark[data-search-highlight="true"]')).toHaveLength(2);
    expect(markedText(root)).toEqual(['inte', 'rest', 'ing', 'art']);
    expect(root.textContent).toBe('interesting art');
  });

  it('装饰后的单词仍能读出完整的查词选区和原句', () => {
    const root = renderHtml('<p>An interesting story.</p>', ['interesting']);
    document.body.append(root);
    const word = root.querySelector('[data-vocabulary-word]')!;
    const range = document.createRange();
    range.selectNodeContents(word);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 }),
    });
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    try {
      const result = readLearningSelection(root);
      expect(result?.selectedText).toBe('interesting');
      expect(result?.sentences).toEqual(['An interesting story.']);
    } finally {
      selection.removeAllRanges();
      root.remove();
    }
  });

  it('重复处理不会嵌套标记，没有生词时原样返回', () => {
    const html = '<p>art &amp; craft</p>';
    expect(emphasizeVocabulary(html, [])).toBe(html);
    const once = emphasizeVocabulary(html, ['art']);
    expect(emphasizeVocabulary(once, ['art'])).toBe(once);
  });
});
