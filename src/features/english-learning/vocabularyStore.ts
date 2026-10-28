import { create } from 'zustand';
import { listVocabulary } from '@/lib/api/apiClient';
import { useAuthStore } from '@/store/authStore';
import type { VocabularyEntry } from '@/types';

interface VocabularyState {
  items: VocabularyEntry[];
  loaded: boolean;
  loading: boolean;
  error: string;
  load: (refresh?: boolean) => Promise<void>;
  upsert: (entry: VocabularyEntry, userId: string | undefined) => void;
  remove: (id: string, userId: string | undefined) => void;
}

type VocabularyRequest = {
  controller: AbortController;
  promise: Promise<void>;
  changes: Map<string, VocabularyEntry | null>;
};
let request: VocabularyRequest | null = null;

function isCurrentUser(userId: string | undefined): boolean {
  return Boolean(userId && useAuthStore.getState().currentUser?.id === userId);
}

// 阅读器和生词本共用当前用户的会话缓存，切换文章无需重复加载。
export const useVocabularyStore = create<VocabularyState>()((set, get) => ({
  items: [],
  loaded: false,
  loading: false,
  error: '',
  load: (refresh = false) => {
    const userId = useAuthStore.getState().currentUser?.id;
    if (!userId) return Promise.resolve();
    if (request) return request.promise;
    if (get().loaded && !refresh) return Promise.resolve();

    const pending: VocabularyRequest = {
      controller: new AbortController(),
      promise: Promise.resolve(),
      changes: new Map(),
    };
    request = pending;
    set({ loading: true, error: '' });
    pending.promise = (async () => {
      try {
        const result = await listVocabulary({ notifyOnError: false }, pending.controller.signal);
        if (pending.controller.signal.aborted || !isCurrentUser(userId)) return;
        // 加载期间的收藏/删除优先于可能较早生成的列表响应。
        const items = new Map(result.items.map((entry) => [entry.id, entry]));
        for (const [id, entry] of pending.changes) {
          if (entry) items.set(id, entry);
          else items.delete(id);
        }
        set({ items: [...items.values()], loaded: true });
      } catch (error) {
        if (!pending.controller.signal.aborted && isCurrentUser(userId)) {
          set({ error: error instanceof Error ? error.message : '生词本加载失败' });
        }
      } finally {
        if (request === pending) {
          request = null;
          set({ loading: false });
        }
      }
    })();
    return pending.promise;
  },
  upsert: (entry, userId) => {
    if (!isCurrentUser(userId)) return;
    request?.changes.set(entry.id, entry);
    set((state) => ({
      items: state.items.some((item) => item.id === entry.id)
        ? state.items.map((item) => item.id === entry.id ? entry : item)
        : [entry, ...state.items],
    }));
  },
  remove: (id, userId) => {
    if (!isCurrentUser(userId)) return;
    request?.changes.set(id, null);
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  },
}));

useAuthStore.subscribe((state, previous) => {
  if (state.currentUser?.id === previous.currentUser?.id) return;
  request?.controller.abort();
  request = null;
  useVocabularyStore.setState({ items: [], loaded: false, loading: false, error: '' });
});
