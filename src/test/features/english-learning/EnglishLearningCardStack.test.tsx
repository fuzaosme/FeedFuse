import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import EnglishLearningCardStack from '@/features/english-learning/components/EnglishLearningCardStack';
import type { LearningCardState } from '@/features/english-learning/hooks/useEnglishLearning';

let resizeCallbacks: ResizeObserverCallback[] = [];

class MockResizeObserver {
  constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); }
  observe() {}
  unobserve() {}
  disconnect() {}
}

function makeCard(id: number, term: string, meanings: string[]): LearningCardState {
  return {
    id,
    selection: {
      selectedText: 'uing quickl',
      wordCount: 2,
      sentences: ['arguing quickly'],
      rect: { left: 10, right: 80, top: 20, bottom: 40 },
      pieces: [],
    },
    term,
    articleId: 'article-1',
    userId: 'user-1',
    kind: 'word',
    loading: false,
    dictionary: { status: 'found', entry: { meanings }, dictionaryId: 'builtin-ecdict-core' },
    explanation: '',
    error: '',
    missingConfig: false,
    saving: false,
    saved: false,
    invalidSelection: false,
    context: 'arguing quickly in the meeting',
    detailLoading: false,
    detailText: '',
    detailError: '',
    detailMissingConfig: false,
  };
}

function makeSentenceCard(id: number, explanation: string, error = ''): LearningCardState {
  return {
    ...makeCard(id, '', []),
    kind: 'sentence',
    term: '',
    dictionary: null,
    selection: {
      selectedText: 'kept arguing about the plan',
      wordCount: 5,
      sentences: ['The team kept arguing about the plan for hours.'],
      rect: { left: 10, right: 80, top: 20, bottom: 40 },
      pieces: [],
    },
    explanation,
    error,
  };
}

function renderStack(
  cards: LearningCardState[],
  overrides: Partial<ComponentProps<typeof EnglishLearningCardStack>> = {},
) {
  return render(
    <EnglishLearningCardStack
      cards={cards}
      onClose={vi.fn()}
      onCloseCard={vi.fn()}
      onRetry={vi.fn()}
      onSave={vi.fn()}
      onExplainDetail={vi.fn()}
      onRetryDetail={vi.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  resizeCallbacks = [];
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('EnglishLearningCardStack', () => {
  function mockBounds(left: number, top: number, width: number, height: number): DOMRect {
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) };
  }

  function mockDesktopRegion(articlePaneRight = 640) {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('innerHeight', 900);
    const { container } = render(
      <div data-reader-layout="desktop"><div data-reader-pane="articles" /></div>,
    );
    const layout = container.firstElementChild as HTMLElement;
    const articlePane = layout.firstElementChild as HTMLElement;
    layout.getBoundingClientRect = vi.fn(() => mockBounds(0, 0, 1440, 900));
    const paneBounds = vi.fn(() => mockBounds(0, 0, articlePaneRight, 900));
    articlePane.getBoundingClientRect = paneBounds;
    return paneBounds;
  }

  function resizeObservedElements() {
    act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
  }

  it('桌面端贴近中栏与正文栏的边界向左展开，高度对齐正文选区', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(mockBounds(0, 0, 352, 200));
    mockDesktopRegion();
    const card = makeCard(1, 'arguing', ['争论']);
    card.selection.rect = { left: 1100, right: 1200, top: 80, bottom: 100 };
    renderStack([card]);

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ left: '280px', top: '80px', maxWidth: '624px' });
  });

  it('侧栏折叠后较窄的区域会限制句子卡宽度，仍不侵入正文', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(mockBounds(0, 0, 480, 300));
    mockDesktopRegion(320);
    renderStack([makeSentenceCard(1, '译文')]);

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ left: '8px', top: '20px', maxWidth: '304px' });
    expect(screen.getByRole('dialog')).toHaveClass('max-w-full');
  });

  it('调整栏宽时继续贴近中栏右边界', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(mockBounds(0, 0, 352, 200));
    const paneBounds = mockDesktopRegion();
    renderStack([makeCard(1, 'arguing', ['争论'])]);
    paneBounds.mockReturnValue(mockBounds(0, 0, 800, 900));
    resizeObservedElements();

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ left: '440px', top: '20px', maxWidth: '784px' });
  });

  it('解释流式增长时保持贴边，接近底部时上移以容纳内容', () => {
    const stackBounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue(mockBounds(0, 0, 352, 200));
    mockDesktopRegion();
    const card = makeCard(1, 'arguing', ['争论']);
    card.selection.rect = { left: 1100, right: 1200, top: 600, bottom: 620 };
    renderStack([card]);
    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ left: '280px', top: '600px' });
    stackBounds.mockReturnValue(mockBounds(0, 0, 352, 480));
    resizeObservedElements();

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ left: '280px', top: '412px' });
    expect(screen.getByRole('dialog').parentElement).toHaveClass('overflow-y-auto', 'max-h-[calc(100dvh-16px)]');
  });

  it.each([
    { anchorTop: -30, expectedTop: 8 },
    { anchorTop: 860, expectedTop: 692 },
  ])('选区位于 $anchorTop px 时将卡片限制在可视区域内', ({ anchorTop, expectedTop }) => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(mockBounds(0, 0, 352, 200));
    mockDesktopRegion();
    const card = makeCard(1, 'arguing', ['争论']);
    card.selection.rect = { left: 1100, right: 1200, top: anchorTop, bottom: anchorTop + 20 };
    renderStack([card]);

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ left: '280px', top: `${expectedTop}px` });
  });

  it('没有桌面三栏布局时继续在选区附近弹出，并限制在视口内', () => {
    vi.stubGlobal('innerWidth', 375);
    vi.stubGlobal('innerHeight', 700);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(mockBounds(0, 0, 352, 200));
    const card = makeCard(1, 'arguing', ['争论']);
    card.selection.rect = { left: 350, right: 370, top: 620, bottom: 640 };
    renderStack([card]);

    expect(screen.getByRole('dialog').parentElement).toHaveStyle({ left: '15px', top: '412px', maxWidth: '359px' });
  });

  it('一次选区解析出的多个整词各自渲染一张卡片', () => {
    renderStack([makeCard(1, 'arguing', ['争论']), makeCard(2, 'quickly', ['迅速地'])]);

    expect(screen.getAllByRole('dialog', { name: /^单词释义/ })).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'arguing' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'quickly' })).toBeInTheDocument();
    expect(screen.getByText('争论')).toBeInTheDocument();
    expect(screen.getByText('迅速地')).toBeInTheDocument();
  });

  it('每张卡片的「加入生词本」只保存对应的词', () => {
    const onSave = vi.fn();
    renderStack(
      [makeCard(1, 'arguing', ['争论']), makeCard(2, 'quickly', ['迅速地'])],
      { onSave },
    );

    fireEvent.click(screen.getAllByRole('button', { name: '加入生词本' })[1]);
    expect(onSave).toHaveBeenCalledWith(2);
  });

  it('每张卡片的关闭按钮只收起自己', () => {
    const onCloseCard = vi.fn();
    renderStack(
      [makeCard(1, 'arguing', ['争论']), makeCard(2, 'quickly', ['迅速地'])],
      { onCloseCard },
    );

    fireEvent.click(screen.getAllByRole('button', { name: '关闭学习卡片' })[0]);
    expect(onCloseCard).toHaveBeenCalledWith(1);
  });

  it('单词卡的「详细解释」按钮只请求对应卡片，并展示返回的详细解释', () => {
    const onExplainDetail = vi.fn();
    const card = { ...makeCard(2, 'quickly', ['迅速地']), detailText: '此处表示“很快地”。' };
    renderStack([makeCard(1, 'arguing', ['争论']), card], { onExplainDetail });

    expect(screen.getAllByRole('button', { name: '详细解释' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: '详细解释' })[1]);
    expect(onExplainDetail).toHaveBeenCalledWith(2);
    expect(screen.getByText('AI 详细解释')).toBeInTheDocument();
    expect(screen.getByText('此处表示“很快地”。')).toBeInTheDocument();
  });

  it('详细解释缺少 AI 配置时提示打开设置', () => {
    const card = { ...makeCard(1, 'arguing', ['争论']), detailMissingConfig: true };
    renderStack([card], { onOpenSettings: vi.fn() });

    expect(screen.getByRole('button', { name: '打开设置' })).toBeInTheDocument();
  });

  it('句子讲解成功后可“重新生成”，废回答能覆盖', () => {
    const onRetry = vi.fn();
    renderStack([makeSentenceCard(1, '初版讲解')], { onRetry });

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    expect(onRetry).toHaveBeenCalledWith(1);
  });

  it('句子讲解失败时显示“重试”', () => {
    const onRetry = vi.fn();
    renderStack([makeSentenceCard(1, '', '暂时无法生成讲解，请重试')], { onRetry });

    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(onRetry).toHaveBeenCalledWith(1);
  });

  it('已有详细解释时可“重新生成解释”，失败时可“重试详细解释”', () => {
    const onRetryDetail = vi.fn();
    const regenCard = { ...makeCard(1, 'quickly', ['迅速地']), detailText: '初版详细解释' };
    const { unmount } = renderStack([regenCard], { onRetryDetail });

    fireEvent.click(screen.getByRole('button', { name: '重新生成解释' }));
    expect(onRetryDetail).toHaveBeenCalledWith(1);
    unmount();
    cleanup();

    const onRetryDetail2 = vi.fn();
    const failedCard = { ...makeCard(2, 'quickly', ['迅速地']), detailError: '详细解释暂时不可用' };
    renderStack([failedCard], { onRetryDetail: onRetryDetail2 });

    fireEvent.click(screen.getByRole('button', { name: '重试详细解释' }));
    expect(onRetryDetail2).toHaveBeenCalledWith(2);
  });
});
