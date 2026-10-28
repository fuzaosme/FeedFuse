import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ArticleView from '@/features/articles/components/ArticleView';
import { useLearningStore } from '@/features/english-learning/learningStore';
import { useVocabularyStore } from '@/features/english-learning/vocabularyStore';
import { defaultPersistedSettings } from '@/features/settings/settingsSchema';
import { addVocabulary, deleteVocabulary, listVocabulary } from '@/lib/api/apiClient';
import { useAppStore } from '@/store/appStore';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { VocabularyEntry } from '@/types';

vi.mock('@/lib/api/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/apiClient')>();
  return {
    ...actual,
    listVocabulary: vi.fn(),
    addVocabulary: vi.fn(),
    deleteVocabulary: vi.fn(),
    getArticleTasks: vi.fn().mockResolvedValue({
      fulltext: { status: 'idle' }, ai_summary: { status: 'idle' }, ai_translate: { status: 'idle' },
    }),
  };
});

vi.mock('@/features/english-learning/utils/dictionary', () => ({
  lookupDictionary: vi.fn().mockResolvedValue({
    status: 'found', dictionaryId: 'builtin-ecdict-core', entry: { term: 'art', meanings: ['艺术'] },
  }),
  warmLearningDictionaries: vi.fn(),
}));

const entry: VocabularyEntry = {
  id: 'word-1', term: 'art', normalizedTerm: 'art', definition: '艺术',
  sourceArticleId: 'article-1', sourceTitle: 'A story', sourceUrl: 'https://example.com',
  sourceSentence: 'Art is here.', createdAt: '2026-10-16', updatedAt: '2026-10-16',
};

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
  });
  useAuthStore.setState({ currentUser: null });
  useAuthStore.setState({ currentUser: { id: 'user-1', role: 'member' } });
  useSettingsStore.setState({ persistedSettings: structuredClone(defaultPersistedSettings) });
  useAppStore.setState({
    feeds: [],
    articles: ['article-1', 'article-2'].map((id) => ({
      id, feedId: 'feed-1', title: 'A story', content: '<p>Art is here. An article about art.</p>',
      summary: '', publishedAt: '2026-10-16T00:00:00.000Z', link: 'https://example.com',
      isRead: true, isStarred: false,
    })),
    selectedArticleId: 'article-1', selectedView: 'all', snapshotLoading: false,
  });
  vi.mocked(listVocabulary).mockReset().mockResolvedValue({ items: [entry] });
  vi.mocked(addVocabulary).mockReset().mockResolvedValue({ entry });
  vi.mocked(deleteVocabulary).mockReset().mockResolvedValue({ deleted: true });
});

afterEach(() => {
  cleanup();
  window.getSelection()?.removeAllRanges();
  useAuthStore.setState({ currentUser: null });
  vi.unstubAllGlobals();
});

function emphasis() {
  return screen.getByTestId('article-html-content').querySelectorAll('[data-vocabulary-word]');
}

describe('ArticleView 生词提示', () => {
  it('普通模式默认标记已存单词，与搜索高亮并存，切换文章复用列表', async () => {
    render(<ArticleView highlightQuery="Art" />);
    await waitFor(() => expect(emphasis()).toHaveLength(2));
    expect(useLearningStore.getState().enabled).toBe(false);
    expect([...emphasis()].map((span) => span.textContent)).toEqual(['Art', 'art']);
    expect(screen.getByTestId('article-html-content').querySelectorAll('mark')).toHaveLength(3);
    act(() => useAppStore.setState({ selectedArticleId: 'article-2' }));
    await waitFor(() => expect(emphasis()).toHaveLength(2));
    expect(listVocabulary).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '英语学习模式' }));
    expect(emphasis()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: '英语学习模式' }));
    expect(emphasis()).toHaveLength(2);
  });

  it('窄屏普通阅读也显示提示', async () => {
    vi.stubGlobal('innerWidth', 390);
    render(<ArticleView />);
    await waitFor(() => expect(emphasis()).toHaveLength(2));
    expect(screen.queryByRole('button', { name: '英语学习模式' })).not.toBeInTheDocument();
  });

  it('生词加载和删除引发正文更新后，仍保留图片的键盘查看入口', async () => {
    useAppStore.setState((state) => ({
      articles: state.articles.map((article) => ({
        ...article, content: '<p>Art is here.</p><img src="/cover.png" alt="封面"><video src="/clip.mp4"></video>',
      })),
    }));
    render(<ArticleView />);
    await waitFor(() => expect(emphasis()).toHaveLength(1));
    const image = screen.getByRole('button', { name: '查看大图：封面' });
    expect(image).toHaveAttribute('tabindex', '0');
    expect(image).toHaveClass('cursor-zoom-in');
    act(() => useVocabularyStore.getState().remove(entry.id, 'user-1'));
    expect(screen.getByRole('button', { name: '查看大图：封面' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('article-html-content').querySelector('video')).toHaveClass('w-full', 'rounded-lg');
  });

  it('在查词卡片中加入后立即加粗，并保留已保存的卡片', async () => {
    vi.mocked(listVocabulary).mockResolvedValue({ items: [] });
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      matches: true, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(),
      removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    useLearningStore.setState({ enabled: true });
    render(<ArticleView />);
    await waitFor(() => expect(useVocabularyStore.getState().loaded).toBe(true));
    const content = screen.getByTestId('article-html-content');
    const textNode = content.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 3);
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 10, right: 80, top: 20, bottom: 40, width: 70, height: 20 }),
    });
    window.getSelection()!.addRange(range);
    const pointerUp = new Event('pointerup', { bubbles: true });
    Object.defineProperties(pointerUp, { pointerType: { value: 'mouse' }, button: { value: 0 } });
    fireEvent(content, pointerUp);
    const save = await screen.findByRole('button', { name: '加入生词本' });
    fireEvent.click(save);
    await waitFor(() => expect(emphasis()).toHaveLength(2));
    expect(await screen.findByRole('button', { name: '已加入生词本' })).toBeInTheDocument();
    expect(addVocabulary).toHaveBeenCalledWith(expect.objectContaining({ term: 'Art' }), expect.anything(), expect.anything());
  });

  it('从生词本删除后立即取消正文提示', async () => {
    render(<ArticleView />);
    await waitFor(() => expect(emphasis()).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: '打开生词本' }));
    fireEvent.click(await screen.findByRole('button', { name: '删除 art' }));
    await waitFor(() => expect(emphasis()).toHaveLength(0));
    expect(deleteVocabulary).toHaveBeenCalledWith(entry.id, expect.anything(), expect.anything());
  });

  it('生词加载失败不影响正文阅读，退出登录会清除提示', async () => {
    vi.mocked(listVocabulary).mockRejectedValueOnce(new Error('网络暂不可用'));
    render(<ArticleView />);
    await waitFor(() => expect(useVocabularyStore.getState().error).toBe('网络暂不可用'));
    expect(screen.getByTestId('article-html-content')).toHaveTextContent('Art is here.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    act(() => useVocabularyStore.getState().upsert(entry, 'user-1'));
    expect(emphasis()).toHaveLength(2);
    act(() => useAuthStore.getState().clearCurrentUser());
    expect(emphasis()).toHaveLength(0);
  });
});
