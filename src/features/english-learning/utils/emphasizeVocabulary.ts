import { normalizeVocabularyTerm } from '@/lib/englishLearning';

const EXCLUDED = [
  '.ff-translation', '[data-translation]', 'pre', 'code', 'kbd', 'samp',
  'button', 'input', 'textarea', 'select', '[contenteditable]', '[role="button"]',
  'script', 'style', 'noscript', 'svg', 'math', '[hidden]', '[aria-hidden="true"]',
].join(',');
const BLOCKS = 'address,article,aside,blockquote,dd,div,dl,dt,figcaption,figure,footer,header,h1,h2,h3,h4,h5,h6,li,main,nav,ol,p,section,table,tbody,td,tfoot,th,thead,tr,ul,hr';
const WORD_CHARACTER = '[\\p{L}\\p{N}\\p{M}_]';
const WORD_JOINER = "['’‘\\u2010\\u2011-]";

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termPattern(term: string): string {
  return term.split(/([ '-])/).map((part) => {
    if (part === ' ') return '\\s+';
    if (part === "'") return "['’‘]";
    if (part === '-') return '[-\\u2010-\\u2014]';
    return escapePattern(part);
  }).join('');
}

/** 只装饰正文文本，保留原 HTML、链接、搜索标记以及跨内联元素的完整词组。 */
export function emphasizeVocabulary(html: string, terms: readonly string[]): string {
  if (!html || !terms.length || typeof DOMParser !== 'function') return html;
  const normalized = [...new Set(terms.map(normalizeVocabularyTerm).filter(Boolean))]
    .sort((left, right) => right.length - left.length);
  if (!normalized.length) return html;
  // 引号与破折号是标点；词内撇号和连字符则属于整个单词。
  const pattern = new RegExp(
    `(?<!${WORD_CHARACTER})(?<!${WORD_CHARACTER}${WORD_JOINER})` +
    `(?:${normalized.map(termPattern).join('|')})` +
    `(?!${WORD_CHARACTER}|${WORD_JOINER}${WORD_CHARACTER})`,
    'giu',
  );
  const doc = new DOMParser().parseFromString(html, 'text/html');
  // 支持重复处理而不产生嵌套标记。
  for (const span of doc.querySelectorAll('span[data-vocabulary-word]')) {
    span.replaceWith(...span.childNodes);
  }

  let nodes: { node: Text; start: number; end: number }[] = [];
  let text = '';
  const flush = () => {
    pattern.lastIndex = 0;
    const ranges = [...text.matchAll(pattern)]
      .map((match) => ({ start: match.index, end: match.index + match[0].length }));
    for (const { node, start, end } of nodes) {
      const overlaps = ranges.filter((range) => range.start < end && range.end > start);
      if (!overlaps.length) continue;
      const fragment = doc.createDocumentFragment();
      let offset = 0;
      for (const range of overlaps) {
        const from = Math.max(0, range.start - start);
        const to = Math.min(node.length, range.end - start);
        fragment.append(node.data.slice(offset, from));
        const span = doc.createElement('span');
        span.className = 'ff-vocabulary-word';
        span.setAttribute('data-vocabulary-word', 'true');
        span.textContent = node.data.slice(from, to);
        fragment.append(span);
        offset = to;
      }
      fragment.append(node.data.slice(offset));
      node.replaceWith(fragment);
    }
    nodes = [];
    text = '';
  };
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? '';
      nodes.push({ node: node as Text, start: text.length, end: text.length + value.length });
      text += value;
      return;
    }
    if (!(node instanceof Element)) return;
    if (node.matches(EXCLUDED)) {
      flush();
      return;
    }
    const boundary = node.matches(BLOCKS) || node.tagName === 'BR';
    if (boundary) flush();
    for (const child of [...node.childNodes]) visit(child);
    if (boundary) flush();
  };
  visit(doc.body);
  flush();
  return doc.body.innerHTML;
}
