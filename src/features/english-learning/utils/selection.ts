import { countEnglishWords } from '@/lib/englishLearning';

const EXCLUDED = [
  '.ff-translation', '[data-translation]', 'pre', 'code', 'a[href]',
  'button', 'input', 'textarea', 'select', '[contenteditable]',
  '[role="button"]', 'script', 'style', '[hidden]', '[aria-hidden="true"]',
].join(',');
const BLOCKS = 'p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,div,section,article';
// 内联链接和代码可作为完整原句的上下文，但不能成为查词选区。
const CONTEXT_EXCLUDED = [
  '.ff-translation', '[data-translation]', 'pre', 'button', 'input', 'textarea',
  'select', '[contenteditable]', '[role="button"]', 'script', 'style',
  '[hidden]', '[aria-hidden="true"]',
].join(',');

export interface LearningSelection {
  selectedText: string;
  wordCount: number;
  sentences: string[];
  rect: { left: number; right: number; top: number; bottom: number };
}

type TextSpan = { node: Text; start: number; selectable: boolean };
type TextBlock = { element: Element; text: string; spans: TextSpan[] };
type SentenceSegmenter = { segment(text: string): Iterable<{ segment: string; index: number }> };

function parentElement(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement;
}

function textBlocks(root: HTMLElement): TextBlock[] {
  const result: TextBlock[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const parent = parentElement(current);
    if (!parent || parent.closest(CONTEXT_EXCLUDED)) continue;
    const element = parent.closest(BLOCKS) ?? root;
    if (!root.contains(element)) continue;
    if (!(current instanceof Text) && !(current instanceof HTMLBRElement)) continue;
    let block = result[result.length - 1];
    if (!block || block.element !== element) {
      block = { element, text: '', spans: [] };
      result.push(block);
    }
    if (current instanceof Text) {
      block.spans.push({ node: current, start: block.text.length, selectable: !parent.closest(EXCLUDED) });
      block.text += current.data;
    } else {
      block.text += '\n';
    }
  }
  return result;
}

function sentencesInRange(text: string, start: number, end: number): string[] {
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: new (locale: string, options: { granularity: 'sentence' }) => SentenceSegmenter;
  }).Segmenter;
  if (!Segmenter) return text.trim() ? [text.trim()] : [];
  try {
    const result: string[] = [];
    for (const part of new Segmenter('en', { granularity: 'sentence' }).segment(text)) {
      const overlapStart = Math.max(start, part.index);
      const overlapEnd = Math.min(end, part.index + part.segment.length);
      if (overlapEnd > overlapStart && text.slice(overlapStart, overlapEnd).trim()) {
        const sentence = part.segment.trim();
        if (sentence) result.push(sentence);
      }
    }
    return result;
  } catch {
    return text.trim() ? [text.trim()] : [];
  }
}

export function readLearningSelection(root: HTMLElement): LearningSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  if (parentElement(range.startContainer)?.closest(EXCLUDED) ||
      parentElement(range.endContainer)?.closest(EXCLUDED)) return null;

  const pieces: string[] = [];
  const sentences: string[] = [];
  for (const block of textBlocks(root)) {
    let start = Infinity;
    let end = -1;
    for (const span of block.spans) {
      if (!range.intersectsNode(span.node)) continue;
      const from = range.startContainer === span.node ? range.startOffset : 0;
      const to = range.endContainer === span.node ? range.endOffset : span.node.length;
      if (to <= from) continue;
      if (!span.selectable && span.node.data.slice(from, to).trim()) return null;
      start = Math.min(start, span.start + from);
      end = Math.max(end, span.start + to);
    }
    if (end <= start || !block.text.slice(start, end).trim()) continue;
    pieces.push(block.text.slice(start, end));
    sentences.push(...sentencesInRange(block.text, start, end));
  }
  const selectedText = pieces.join('\n').trim();
  const wordCount = countEnglishWords(selectedText);
  if (!wordCount || !sentences.length) return null;
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return null;
  return {
    selectedText, wordCount, sentences,
    rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
  };
}
