import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSelectableArticleLinks } from '@/features/articles/hooks/useSelectableArticleLinks';

function Reader({ articleId = '1' }: { articleId?: string }) {
  const handlers = useSelectableArticleLinks(articleId);
  return <div {...handlers}>
    <h1><a href="https://example.com/title" target="_blank" rel="noopener noreferrer">Title</a></h1>
    <p>Read <a href="https://example.com/body" target="_blank" rel="noopener noreferrer"><em>proposal</em></a> here.</p>
    <a href="#notes">Notes</a>
    <a href="https://example.com/image"><img alt="linked image" /></a>
  </div>;
}

describe('selectable article links', () => {
  let opened: { href: string; target: string; rel: string }[];
  beforeEach(() => {
    vi.useFakeTimers();
    opened = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      opened.push({ href: this.href, target: this.target, rel: this.rel });
    });
  });
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    vi.useRealTimers();
  });

  it.each(['Title', 'proposal'])('标题和正文 %s 共用单击延迟与原链接属性', (text) => {
    render(<Reader />);
    const link = screen.getByText(text);
    fireEvent.mouseDown(link, { button: 0, detail: 1 });
    expect(fireEvent.click(link, { button: 0, detail: 1 })).toBe(false);
    expect(opened).toHaveLength(0);
    act(() => vi.advanceTimersByTime(280));
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({ target: '_blank', rel: 'noopener noreferrer' });
  });

  it('双击取消第一次单击跳转，且不取消浏览器选词默认行为', () => {
    render(<Reader />);
    const link = screen.getByText('proposal');
    fireEvent.mouseDown(link, { button: 0, detail: 1 });
    fireEvent.click(link, { button: 0, detail: 1 });
    act(() => vi.advanceTimersByTime(100));
    fireEvent.mouseDown(link, { button: 0, detail: 2 });
    fireEvent.click(link, { button: 0, detail: 2 });
    expect(fireEvent.doubleClick(link)).toBe(true);
    act(() => vi.advanceTimersByTime(500));
    expect(opened).toHaveLength(0);
  });

  it('拖选不会跳转，链接拖拽也不会抢走文字选择', () => {
    render(<Reader />);
    const link = screen.getByText('proposal');
    fireEvent.mouseDown(link, { button: 0, detail: 1, clientX: 10, clientY: 10 });
    fireEvent.click(link, { button: 0, detail: 1, clientX: 80, clientY: 10 });
    expect(fireEvent.dragStart(link)).toBe(false);
    act(() => vi.advanceTimersByTime(500));
    expect(opened).toHaveLength(0);
  });

  it('单击后形成的选区也能取消跳转', () => {
    render(<Reader />);
    const link = screen.getByText('proposal');
    fireEvent.click(link, { button: 0, detail: 1 });
    const range = document.createRange();
    range.selectNodeContents(link);
    window.getSelection()?.addRange(range);
    act(() => vi.advanceTimersByTime(500));
    expect(opened).toHaveLength(0);
  });

  it('键盘、修饰键、图片链接保留默认行为，页内链接保留 target', () => {
    render(<Reader />);
    const link = screen.getByText('proposal');
    expect(fireEvent.click(link, { detail: 0 })).toBe(true);
    expect(fireEvent.click(link, { detail: 1, ctrlKey: true })).toBe(true);
    expect(fireEvent.click(screen.getByAltText('linked image'), { detail: 1 })).toBe(true);
    fireEvent.click(screen.getByText('Notes'), { detail: 1 });
    act(() => vi.advanceTimersByTime(280));
    expect(opened).toHaveLength(1);
    expect(opened[0].target).toBe('');
    expect(opened[0].href).toMatch(/#notes$/);
  });

  it('切换文章后取消旧文章待跳转的链接', () => {
    const view = render(<Reader />);
    fireEvent.click(screen.getByText('proposal'), { detail: 1 });
    view.rerender(<Reader articleId="2" />);
    act(() => vi.advanceTimersByTime(500));
    expect(opened).toHaveLength(0);
  });
});
