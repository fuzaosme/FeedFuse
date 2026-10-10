import { create } from 'zustand';
import { useAuthStore } from '@/store/authStore';

interface LearningState {
  enabled: boolean;
  vocabularyOpen: boolean;
  toggleEnabled: () => void;
  setVocabularyOpen: (open: boolean) => void;
}

// 仅保留当前页面会话，刷新后从关闭状态开始。
export const useLearningStore = create<LearningState>()((set) => ({
  enabled: false,
  vocabularyOpen: false,
  toggleEnabled: () => set((state) => ({ enabled: !state.enabled })),
  setVocabularyOpen: (vocabularyOpen) => set({ vocabularyOpen }),
}));

useAuthStore.subscribe((state, previous) => {
  if (state.currentUser?.id !== previous.currentUser?.id) {
    useLearningStore.setState({ enabled: false, vocabularyOpen: false });
  }
});
