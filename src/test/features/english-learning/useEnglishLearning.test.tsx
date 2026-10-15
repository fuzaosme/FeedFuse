import { useRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEnglishLearning } from '@/features/english-learning/hooks/useEnglishLearning';
import { useLearningStore } from '@/features/english-learning/learningStore';
import { useAuthStore } from '@/store/authStore';
import type { LearningSelection } from '@/features/english-learning/utils/selection';
import { ApiError } from '@/lib/api/apiClient';

const lookupDictionaryMock = vi.fn();
const readLearningSelectionMock = vi.fn();
const addVocabularyMock = vi.fn();
const requestEnglishExplanationMock = vi.fn();
const requestWordDetailMock = vi.fn();
const streamEnglishExplanationMock = vi.fn();
const streamWordDetailMock = vi.fn();

vi.mock('@/features/english-learning/utils/dictionary', () => ({
  lookupDictionary: (...args: unknown[]) => lookupDictionaryMock(...args),
  warmLearningDictionaries: vi.fn(),
}));

vi.mock('@/features/english-learning/utils/selection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/english-learning/utils/selection')>();
  return {
    ...actual,
    readLearningSelection: (...args: unknown[]) => readLearningSelectionMock(...args),
  };
});

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...actual,
    addVocabulary: (...args: unknown[]) => addVocabularyMock(...args),
    requestEnglishExplanation: (...args: unknown[]) => requestEnglishExplanationMock(...args),
    requestWordDetail: (...args: unknown[]) => requestWordDetailMock(...args),
    streamEnglishExplanation: (...args: unknown[]) => streamEnglishExplanationMock(...args),
    streamWordDetail: (...args: unknown[]) => streamWordDetailMock(...args),
  };
});

function selectionFixture(context: string, selected: string, wordCount: number): LearningSelection {
  const start = context.indexOf(selected);
  return {
    selectedText: selected,
    wordCount,
    sentences: [context],
    rect: { left: 10, right: 80, top: 20, bottom: 40 },
    pieces: [{ text: selected, context, start, end: start + selected.length }],
  };
}

function Harness({ onRender }: { onRender: (value: ReturnType<typeof useEnglishLearning>) => void }) {
  const contentRef = useRef<HTMLDivElement | null>(null);
  const learning = useEnglishLearning({
    articleId: 'article-1',
    contentRef,
    contentHtml: '<p>arguing quickly</p>',
    isDesktop: true,
  });
  onRender(learning);
  return <div ref={contentRef} />;
}

async function openSelection(
  harness: { onPointerUp: (event: { pointerType: string; button: number }) => void },
) {
  await act(async () => {
    harness.onPointerUp({ pointerType: 'mouse', button: 0 });
    // onPointerUp 用 0ms 定时器等待浏览器更新选区，这里让定时器和查词 Promise 都在 act 内跑完。
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  useAuthStore.setState({ currentUser: { id: 'user-1', role: 'member' } });
  useLearningStore.setState({ enabled: true, vocabularyOpen: false });
  readLearningSelectionMock.mockReset();
  lookupDictionaryMock.mockReset();
  addVocabularyMock.mockReset();
  requestEnglishExplanationMock.mockReset();
  requestWordDetailMock.mockReset();
  streamEnglishExplanationMock.mockReset();
  streamWordDetailMock.mockReset();
  addVocabularyMock.mockResolvedValue({ entry: { id: 'entry-1' } });
  requestEnglishExplanationMock.mockResolvedValue({ explanation: '句子讲解内容' });
  requestWordDetailMock.mockResolvedValue({ explanation: '详细解释内容' });
  // 默认流式不可用，走 Buffered 回退（与旧行为一致）；需要流式的用例单独覆盖。
  streamEnglishExplanationMock.mockRejectedValue(new ApiError('stream unavailable', 'stream_unsupported'));
  streamWordDetailMock.mockRejectedValue(new ApiError('stream unavailable', 'stream_unsupported'));
  lookupDictionaryMock.mockImplementation(async (term: string) => term.includes(' ')
    ? { status: 'not_found' }
    : { status: 'found', entry: { meanings: ['释义'] }, dictionaryId: 'builtin-ecdict-core' });
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as unknown as MediaQueryList);
});

afterEach(() => {
  // 先卸载组件再重置 store，避免挂在树上的 Hook 收到 act 之外的 store 更新。
  cleanup();
  useLearningStore.setState({ enabled: false, vocabularyOpen: false });
  useAuthStore.setState({ currentUser: null });
});

describe('useEnglishLearning 查词选区解析', () => {
  it('跨两个实义词各选一部分时生成两张卡片并分别查词', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);

    await waitFor(() => {
      expect(state.current?.cards.map((card) => card.term)).toEqual(['arguing', 'quickly']);
    });
    await waitFor(() => {
      expect(lookupDictionaryMock).toHaveBeenCalledWith('arguing');
      expect(lookupDictionaryMock).toHaveBeenCalledWith('quickly');
    });
    expect(state.current?.cards.every((card) => !card.loading)).toBe(true);
  });

  it('功能词选到两个字母时整体未命中也保留查询', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing that', 'uing th', 2));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);

    await waitFor(() => {
      expect(state.current?.cards.map((card) => card.term)).toEqual(['arguing', 'that']);
    });
    expect(lookupDictionaryMock).toHaveBeenCalledTimes(3);
    expect(lookupDictionaryMock).toHaveBeenCalledWith('arguing');
  });

  it('完整选中胶水词时照常查词', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing that', 'that', 1));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);

    await waitFor(() => {
      expect(state.current?.cards.map((card) => card.term)).toEqual(['that']);
    });
    expect(lookupDictionaryMock).toHaveBeenCalledWith('that');
  });

  it('每张卡片单独保存自己解析出的词', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards).toHaveLength(2));
    const secondId = state.current!.cards[1].id;
    await act(async () => {
      await state.current!.saveWord(secondId);
    });

    await waitFor(() => expect(state.current?.cards[1]?.saved).toBe(true));
    expect(state.current?.cards[0]?.saved).toBe(false);
    expect(addVocabularyMock).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'quickly' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('收起一张卡片不影响另一张', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards).toHaveLength(2));
    const firstId = state.current!.cards[0].id;
    act(() => {
      state.current!.closeCard(firstId);
    });

    expect(state.current?.cards.map((card) => card.term)).toEqual(['quickly']);
  });

  it('收起过一张卡片后重新选择同一段文字会重新展开两张卡片', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards).toHaveLength(2));
    act(() => {
      state.current!.closeCard(state.current!.cards[0].id);
    });
    expect(state.current?.cards).toHaveLength(1);

    await openSelection(state.current!);

    await waitFor(() => {
      expect(state.current?.cards.map((card) => card.term)).toEqual(['arguing', 'quickly']);
    });
  });

  it('完整词组未收录时自动拆成逐词卡片', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('a Chinese company', 'Chinese company', 2));
    lookupDictionaryMock.mockImplementation(async (term: string) => (
      term === 'Chinese company'
        ? { status: 'not_found' }
        : { status: 'found', entry: { meanings: [`${term} 的释义`] }, dictionaryId: 'builtin-ecdict-core' }
    ));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);

    await waitFor(() => {
      expect(state.current?.cards.map((card) => card.term)).toEqual(['Chinese', 'company']);
    });
    await waitFor(() => {
      expect(state.current?.cards.every((card) => card.dictionary?.status === 'found')).toBe(true);
    });
    expect(lookupDictionaryMock).toHaveBeenCalledWith('Chinese company');
    expect(state.current?.cards.every((card) => !card.loading)).toBe(true);
  });

  it('词组已收录时保持单卡不拆分', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('give up now', 'give up', 2));
    lookupDictionaryMock.mockImplementation(async (term: string) => ({
      status: 'found', entry: { meanings: [`${term} 的释义`] }, dictionaryId: 'builtin-ecdict-core',
    }));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);

    await waitFor(() => expect(state.current?.cards[0]?.dictionary?.status).toBe('found'));
    expect(state.current?.cards.map((card) => card.term)).toEqual(['give up']);
    expect(lookupDictionaryMock).toHaveBeenCalledTimes(1);
  });

  it('整段都是功能词时未收录也允许逐词查', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('of the book', 'of the', 2));
    lookupDictionaryMock.mockImplementation(async () => ({ status: 'not_found' }));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);

    await waitFor(() => expect(state.current?.cards[0]?.dictionary?.status).toBe('not_found'));
    expect(state.current?.cards.map((card) => card.term)).toEqual(['of', 'the']);
  });
});

describe('useEnglishLearning 语境分析与详细解释', () => {
  it('流超时不会再发一次完整生成请求', async () => {
    const sentence = 'The team kept arguing about the plan for hours.';
    readLearningSelectionMock.mockReturnValue(selectionFixture(sentence, 'kept arguing about the plan', 5));
    streamEnglishExplanationMock.mockRejectedValue(new ApiError('讲解超时', 'timeout'));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.error).toBe('讲解超时'));
    expect(requestEnglishExplanationMock).not.toHaveBeenCalled();
  });

  it('收到部分正文后断流保留内容，不重试也不缓存半截答案', async () => {
    const sentence = 'The team kept arguing about the plan for hours.';
    readLearningSelectionMock.mockReturnValue(selectionFixture(sentence, 'kept arguing about the plan', 5));
    streamEnglishExplanationMock.mockImplementation(async (_id, _body, _signal, options) => {
      options.onDelta('已经生成的译文');
      throw new ApiError('连接中断', 'incomplete_stream');
    });
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.loading).toBe(false));
    expect(state.current?.cards[0]?.explanation).toBe('已经生成的译文');
    expect(state.current?.cards[0]?.error).toBe('连接中断');
    expect(requestEnglishExplanationMock).not.toHaveBeenCalled();
    act(() => state.current!.close());
    await openSelection(state.current!);
    expect(streamEnglishExplanationMock).toHaveBeenCalledTimes(2);
  });

  it('单词详细解释限流后不会再发一次完整生成请求', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'arguing', 1));
    streamWordDetailMock.mockRejectedValue(new ApiError('服务繁忙', 'ai_request_failed'));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await act(async () => { await state.current!.explainDetail(state.current!.cards[0].id); });
    expect(state.current?.cards[0]?.detailError).toBe('服务繁忙');
    expect(requestWordDetailMock).not.toHaveBeenCalled();
  });

  it('句子讲解请求携带选区所在段落作为语境', async () => {
    const sentence = 'The team kept arguing about the plan for hours.';
    readLearningSelectionMock.mockReturnValue(selectionFixture(sentence, 'kept arguing about the plan', 5));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);

    await waitFor(() => expect(state.current?.cards[0]?.explanation).toBe('句子讲解内容'));
    expect(requestEnglishExplanationMock).toHaveBeenCalledWith(
      'article-1',
      expect.objectContaining({
        selectedText: 'kept arguing about the plan',
        sentences: [sentence],
        context: sentence,
      }),
      expect.anything(),
    );
  });

  it('单词卡「详细解释」调用专用接口并携带整词、原句与语境', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards).toHaveLength(2));
    await waitFor(() => expect(state.current?.cards.every((card) => !card.loading)).toBe(true));

    const firstId = state.current!.cards[0].id;
    await act(async () => {
      await state.current!.explainDetail(firstId);
    });

    await waitFor(() => expect(state.current?.cards[0]?.detailText).toBe('详细解释内容'));
    expect(requestWordDetailMock).toHaveBeenCalledWith(
      'article-1',
      expect.objectContaining({
        term: 'arguing',
        selectedText: 'arguing quickly',
        sentences: ['arguing quickly'],
        context: 'arguing quickly',
      }),
      expect.anything(),
    );
  });

  it('详细解释失败时给出错误状态且可重试', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    requestWordDetailMock.mockRejectedValue(new Error('详细解释暂时不可用'));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards.every((card) => !card.loading)).toBe(true));

    await act(async () => {
      await state.current!.explainDetail(state.current!.cards[0].id);
    });

    await waitFor(() => expect(state.current?.cards[0]?.detailError).toBe('详细解释暂时不可用'));
    expect(state.current?.cards[0]?.detailLoading).toBe(false);
  });

  it('句子讲解重新生成时绕过缓存并覆盖废回答', async () => {
    const sentence = 'The team kept arguing about the plan for hours.';
    readLearningSelectionMock.mockReturnValue(selectionFixture(sentence, 'kept arguing about the plan', 5));
    requestEnglishExplanationMock.mockResolvedValue({ explanation: '初版讲解（废回答）' });
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.explanation).toBe('初版讲解（废回答）'));
    expect(requestEnglishExplanationMock).toHaveBeenCalledTimes(1);

    // 关闭后重新选择同一区域：命中缓存，不再发请求。
    act(() => {
      state.current!.close();
    });
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.explanation).toBe('初版讲解（废回答）'));
    expect(requestEnglishExplanationMock).toHaveBeenCalledTimes(1);

    // 重新生成：强制发请求并覆盖缓存。
    requestEnglishExplanationMock.mockResolvedValue({ explanation: '新版讲解' });
    const cardId = state.current!.cards[0].id;
    await act(async () => {
      state.current!.retry(cardId);
    });

    await waitFor(() => expect(state.current?.cards[0]?.explanation).toBe('新版讲解'));
    expect(requestEnglishExplanationMock).toHaveBeenCalledTimes(2);
    expect(state.current?.cards[0]?.error).toBe('');
  });

  it('详细解释失败后 retryDetail 可重试成功', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    requestWordDetailMock.mockRejectedValueOnce(new Error('详细解释暂时不可用'));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards.every((card) => !card.loading)).toBe(true));

    const cardId = state.current!.cards[0].id;
    await act(async () => {
      await state.current!.explainDetail(cardId);
    });
    await waitFor(() => expect(state.current?.cards[0]?.detailError).toBe('详细解释暂时不可用'));

    requestWordDetailMock.mockResolvedValue({ explanation: '重试后的详细解释' });
    await act(async () => {
      state.current!.retryDetail(cardId);
    });

    await waitFor(() => expect(state.current?.cards[0]?.detailText).toBe('重试后的详细解释'));
    expect(state.current?.cards[0]?.detailError).toBe('');
  });

  it('保存单词不中断同卡在途的详细解释请求', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('arguing quickly', 'uing quickl', 2));
    let resolveDetail: ((value: { explanation: string }) => void) | null = null;
    streamWordDetailMock.mockImplementation(() => new Promise((resolve) => {
      resolveDetail = resolve as (value: { explanation: string }) => void;
    }));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);

    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards.every((card) => !card.loading)).toBe(true));

    const cardId = state.current!.cards[0].id;
    let detailPromise: Promise<void> | null = null;
    await act(async () => {
      detailPromise = state.current!.explainDetail(cardId);
      await state.current!.saveWord(cardId);
    });

    // 保存已完成，详细解释仍在途且未被中断。
    await waitFor(() => expect(state.current?.cards[0]?.saved).toBe(true));
    expect(state.current?.cards[0]?.detailLoading).toBe(true);

    await act(async () => {
      resolveDetail!({ explanation: '详细解释内容' });
      await detailPromise!;
    });
    await waitFor(() => expect(state.current?.cards[0]?.detailText).toBe('详细解释内容'));
  });
});

describe('划选容错与词组优先的集成行为', () => {
  it.each([
    ['arguing quickly', 'arguing q', ['arguing']],
    ['arguing quickly', 'arguing qu', ['arguing', 'quickly']],
    ['arguing quickly', 'g quickly', ['quickly']],
    ['arguing quickly', 'ng quickly', ['arguing', 'quickly']],
    ['of which', 'f whic', ['which']],
    ['arguing that', 'uing th', ['arguing', 'that']],
    ['in spite of that', 'in spite of t', ['in', 'spite', 'of']],
  ])('词组未命中后保留明确选词：%s / %s', async (context, selected, expected) => {
    readLearningSelectionMock.mockReturnValue(selectionFixture(context, selected, 0));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards.map((card) => card.term)).toEqual(expected));
    expect(state.current?.cards.every((card) => card.kind === 'word')).toBe(true);
    for (const word of expected) expect(lookupDictionaryMock).toHaveBeenCalledWith(word);
    expect(streamEnglishExplanationMock).not.toHaveBeenCalled();
  });

  it('military’s 查词、展示和收藏均使用 military，语境保留所有格', async () => {
    const context = 'The military’s budget increased.';
    readLearningSelectionMock.mockReturnValue(selectionFixture(context, 'military’s', 1));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.loading).toBe(false));
    expect(state.current?.cards[0]?.term).toBe('military');
    expect(lookupDictionaryMock).toHaveBeenCalledWith('military');
    await act(async () => { await state.current!.saveWord(state.current!.cards[0].id); });
    expect(addVocabularyMock).toHaveBeenCalledWith(
      expect.objectContaining({ term: 'military', sourceSentence: context }), expect.anything(), expect.anything(),
    );
  });

  it.each([
    ['in spite of that', 'n spite o', 'in spite of'],
    ['give up now', 'ive u', 'give up'],
    ['as a result of this', 's a result o', 'as a result of'],
  ])('补全的词组命中时保持整个词组：%s / %s', async (context, selected, phrase) => {
    lookupDictionaryMock.mockImplementation(async (term: string) => term === phrase
      ? { status: 'found', entry: { meanings: ['词组释义'] }, dictionaryId: 'builtin-ecdict-core' }
      : { status: 'not_found' });
    readLearningSelectionMock.mockReturnValue(selectionFixture(context, selected, 0));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.dictionary?.status).toBe('found'));
    expect(state.current?.cards.map((card) => card.term)).toEqual([phrase]);
    expect(lookupDictionaryMock).toHaveBeenCalledTimes(1);
    expect(streamEnglishExplanationMock).not.toHaveBeenCalled();
  });

  it.each([true, false])('四词表达整体查询后再决定是否讲解：命中=%s', async (found) => {
    lookupDictionaryMock.mockResolvedValue(found
      ? { status: 'found', entry: { meanings: ['因此'] }, dictionaryId: 'builtin-ecdict-core' }
      : { status: 'not_found' });
    readLearningSelectionMock.mockReturnValue(selectionFixture('as a result of that', 'as a result of', 4));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.loading).toBe(false));
    expect(lookupDictionaryMock).toHaveBeenCalledWith('as a result of');
    expect(state.current?.cards[0]?.kind).toBe(found ? 'word' : 'sentence');
    expect(streamEnglishExplanationMock).toHaveBeenCalledTimes(found ? 0 : 1);
  });

  it('三词完整句子直接讲解，不先拆词', async () => {
    const sentence = "I don't know.";
    readLearningSelectionMock.mockReturnValue(selectionFixture(sentence, sentence, 3));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.explanation).toBe('句子讲解内容'));
    expect(state.current?.cards[0]?.kind).toBe('sentence');
    expect(lookupDictionaryMock).not.toHaveBeenCalled();
  });

  it('词组未命中转讲解时，AI 收到补全后的表达', async () => {
    readLearningSelectionMock.mockReturnValue(selectionFixture('They kept arguing about the plan.', 'ept arguing about the pla', 5));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.explanation).toBe('句子讲解内容'));
    expect(requestEnglishExplanationMock).toHaveBeenCalledWith('article-1', expect.objectContaining({
      selectedText: 'kept arguing about the plan',
    }), expect.any(AbortSignal));
  });

  it.each(['error', 'unconfigured'])('词典状态 %s 不能冒充未收录并自动触发 AI', async (status) => {
    lookupDictionaryMock.mockResolvedValue({ status });
    readLearningSelectionMock.mockReturnValue(selectionFixture('as a result of that', 'as a result of', 4));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.loading).toBe(false));
    expect(state.current?.cards[0]?.dictionary?.status).toBe(status);
    expect(streamEnglishExplanationMock).not.toHaveBeenCalled();
  });

  it('等待词组查询期间关闭卡片，迟到的未命中不能触发讲解或重开卡片', async () => {
    let resolveLookup!: (value: unknown) => void;
    lookupDictionaryMock.mockImplementation(() => new Promise((resolve) => { resolveLookup = resolve; }));
    readLearningSelectionMock.mockReturnValue(selectionFixture('as a result of that', 'as a result of', 4));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    act(() => state.current!.closeCard(state.current!.cards[0].id));
    await act(async () => { resolveLookup({ status: 'not_found' }); });
    expect(state.current?.cards).toHaveLength(0);
    expect(streamEnglishExplanationMock).not.toHaveBeenCalled();
  });
});

describe('词组查询重试', () => {
  it.each([
    ['arguing quickly', 'uing quickl', ['arguing', 'quickly'], 'word'],
    ['as a result of that', 'as a result of', ['as a result of'], 'sentence'],
  ])('查询报错后重试仍执行未命中处理：%s', async (context, selected, terms, kind) => {
    lookupDictionaryMock.mockResolvedValueOnce({ status: 'error' });
    readLearningSelectionMock.mockReturnValue(selectionFixture(context, selected, 0));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.dictionary?.status).toBe('error'));
    await act(async () => { state.current!.retry(state.current!.cards[0].id); });
    await waitFor(() => {
      expect(state.current?.cards.map((card) => card.term)).toEqual(terms);
      expect(state.current?.cards.every((card) => card.kind === kind && !card.loading)).toBe(true);
    });
    expect(streamEnglishExplanationMock).toHaveBeenCalledTimes(kind === 'sentence' ? 1 : 0);
  });
});

describe('含标点的长片段', () => {
  it('重复单词去重后即使只剩一个词，也不能代替整段讲解', async () => {
    const context = 'Well, well, well, well, the team agreed.';
    readLearningSelectionMock.mockReturnValue(selectionFixture(context, 'Well, well, well, well', 4));
    const state = { current: null as ReturnType<typeof useEnglishLearning> | null };
    render(<Harness onRender={(value) => { state.current = value; }} />);
    await openSelection(state.current!);
    await waitFor(() => expect(state.current?.cards[0]?.kind).toBe('sentence'));
    expect(lookupDictionaryMock).not.toHaveBeenCalled();
    expect(streamEnglishExplanationMock).toHaveBeenCalledTimes(1);
  });
});
