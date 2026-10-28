import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listVocabulary } from '@/lib/api/apiClient';
import { useVocabularyStore } from '@/features/english-learning/vocabularyStore';
import { useAuthStore } from '@/store/authStore';
import type { VocabularyEntry } from '@/types';

vi.mock('@/lib/api/apiClient', () => ({ listVocabulary: vi.fn() }));

const entry: VocabularyEntry = {
  id: 'word-1', term: 'art', normalizedTerm: 'art', definition: '艺术',
  sourceArticleId: 'article-1', sourceTitle: 'A story', sourceUrl: 'https://example.com',
  sourceSentence: 'Art is here.', createdAt: '2026-10-16', updatedAt: '2026-10-16',
};

beforeEach(() => {
  useAuthStore.setState({ currentUser: null });
  useAuthStore.setState({ currentUser: { id: 'user-1', role: 'member' } });
  vi.mocked(listVocabulary).mockReset();
});

afterEach(() => useAuthStore.setState({ currentUser: null }));

describe('阅读器共享生词缓存', () => {
  it('合并并发加载，切换文章时复用列表，主动刷新时重新请求', async () => {
    vi.mocked(listVocabulary).mockResolvedValue({ items: [entry] });
    await Promise.all([useVocabularyStore.getState().load(), useVocabularyStore.getState().load()]);
    await useVocabularyStore.getState().load();
    expect(listVocabulary).toHaveBeenCalledTimes(1);
    expect(useVocabularyStore.getState().items).toEqual([entry]);
    await useVocabularyStore.getState().load(true);
    expect(listVocabulary).toHaveBeenCalledTimes(2);
  });

  it('较早的列表响应不会覆盖加载期间成功的加入、编辑和删除', async () => {
    let respond!: (value: { items: VocabularyEntry[] }) => void;
    vi.mocked(listVocabulary).mockImplementation(() => new Promise((resolve) => { respond = resolve; }));
    const loading = useVocabularyStore.getState().load();
    const added = { ...entry, id: 'word-2', term: 'rain', normalizedTerm: 'rain' };
    const edited = { ...entry, id: 'word-3', definition: '编辑后的释义' };
    useVocabularyStore.getState().upsert(added, 'user-1');
    useVocabularyStore.getState().upsert(edited, 'user-1');
    useVocabularyStore.getState().remove(entry.id, 'user-1');
    respond({ items: [entry, { ...edited, definition: '旧释义' }] });
    await loading;
    expect(useVocabularyStore.getState().items).toEqual(expect.arrayContaining([added, edited]));
    expect(useVocabularyStore.getState().items).toHaveLength(2);
  });

  it('切换账户立即清空，丢弃旧账户的异步响应和修改', async () => {
    let respond!: (value: { items: VocabularyEntry[] }) => void;
    vi.mocked(listVocabulary).mockImplementationOnce(() => new Promise((resolve) => { respond = resolve; }));
    useVocabularyStore.getState().upsert(entry, 'user-1');
    const oldRequest = useVocabularyStore.getState().load();
    const oldSignal = vi.mocked(listVocabulary).mock.calls[0][1]!;
    useAuthStore.setState({ currentUser: { id: 'user-2', role: 'member' } });
    expect(oldSignal.aborted).toBe(true);
    expect(useVocabularyStore.getState().items).toEqual([]);
    vi.mocked(listVocabulary).mockResolvedValueOnce({ items: [] });
    await useVocabularyStore.getState().load();
    respond({ items: [entry] });
    await oldRequest;
    useVocabularyStore.getState().upsert(entry, 'user-1');
    expect(useVocabularyStore.getState().items).toEqual([]);
    expect(useVocabularyStore.getState().loaded).toBe(true);
  });

  it('失败静默记录且允许重试，退出登录后不再请求', async () => {
    vi.mocked(listVocabulary).mockRejectedValueOnce(new Error('暂时无法加载'));
    await useVocabularyStore.getState().load();
    expect(useVocabularyStore.getState()).toMatchObject({ loaded: false, loading: false, error: '暂时无法加载' });
    expect(listVocabulary).toHaveBeenCalledWith({ notifyOnError: false }, expect.any(AbortSignal));
    vi.mocked(listVocabulary).mockResolvedValueOnce({ items: [entry] });
    await useVocabularyStore.getState().load();
    expect(useVocabularyStore.getState().error).toBe('');
    useAuthStore.setState({ currentUser: null });
    await useVocabularyStore.getState().load();
    expect(listVocabulary).toHaveBeenCalledTimes(2);
  });
});
