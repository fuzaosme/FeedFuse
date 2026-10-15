import { useCallback, useEffect, useRef, type DragEvent, type MouseEvent } from 'react';

const OPEN_DELAY_MS = 280;
const DRAG_THRESHOLD_PX = 5;

function textLink(event: MouseEvent<HTMLElement> | DragEvent<HTMLElement>) {
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest('a[href]');
  return anchor instanceof HTMLAnchorElement && event.currentTarget.contains(anchor) &&
    anchor.textContent?.trim() ? anchor : null;
}

function selectionTouches(anchor: HTMLAnchorElement) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  try {
    return selection.containsNode(anchor, true) ||
      Boolean(selection.anchorNode && anchor.contains(selection.anchorNode)) ||
      Boolean(selection.focusNode && anchor.contains(selection.focusNode));
  } catch {
    return true;
  }
}

/** 标题与正文共用：单击打开链接，拖选/双击保留浏览器原生选词。 */
export function useSelectableArticleLinks(articleId: string | undefined) {
  const press = useRef<{ anchor: HTMLAnchorElement; x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const clearPending = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => () => {
    clearPending();
    press.current = null;
  }, [articleId, clearPending]);

  const onMouseDown = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    clearPending();
    const anchor = textLink(event);
    press.current = anchor ? { anchor, x: event.clientX, y: event.clientY } : null;
  }, [clearPending]);

  const onClick = useCallback((event: MouseEvent<HTMLElement>) => {
    const anchor = textLink(event);
    const origin = press.current;
    press.current = null;
    if (!anchor || event.defaultPrevented || event.detail === 0 || event.button !== 0 ||
      event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    clearPending();
    if (event.detail > 1 || selectionTouches(anchor) || (origin?.anchor === anchor &&
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > DRAG_THRESHOLD_PX)) return;

    // 用脱离阅读区的锚点保留原链接的 target、页内定位和 mailto 等行为。
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!anchor.isConnected || selectionTouches(anchor)) return;
      const link = document.createElement('a');
      link.href = anchor.href;
      link.target = anchor.target;
      link.rel = anchor.rel;
      if (anchor.hasAttribute('download')) link.download = anchor.download;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }, OPEN_DELAY_MS);
  }, [clearPending]);

  const onDragStart = useCallback((event: DragEvent<HTMLElement>) => {
    if (textLink(event)) event.preventDefault();
  }, []);

  return { onMouseDown, onClick, onDoubleClick: clearPending, onDragStart };
}
