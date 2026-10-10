import { useCallback, useEffect, useRef, useState, type RefObject, type PointerEvent } from 'react';
import { ApiError, addVocabulary, requestEnglishExplanation } from '@/lib/api/apiClient';
import { cleanVocabularyTerm, ENGLISH_LEARNING_MAX_TEXT_LENGTH } from '@/lib/englishLearning';
import { useAuthStore } from '@/store/authStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useLearningStore } from '../learningStore';
import { lookupDictionary, type DictionaryResult } from '../utils/dictionary';
import { readLearningSelection, type LearningSelection } from '../utils/selection';

export interface LearningCardState {
  selection: LearningSelection;
  articleId: string;
  userId: string | undefined;
  kind: 'word' | 'sentence';
  loading: boolean;
  dictionary: DictionaryResult | null;
  explanation: string;
  error: string;
  missingConfig: boolean;
  saving: boolean;
  saved: boolean;
  invalidSelection: boolean;
}

interface HookInput {
  articleId: string | null;
  contentRef: RefObject<HTMLDivElement | null>;
  contentHtml: string;
  isDesktop: boolean;
}

export function useEnglishLearning({ articleId, contentRef, contentHtml, isDesktop }: HookInput) {
  const enabled = useLearningStore((state) => state.enabled);
  const vocabularyOpen = useLearningStore((state) => state.vocabularyOpen);
  const userId = useAuthStore((state) => state.currentUser?.id);
  const ai = useSettingsStore((state) => state.persistedSettings.ai);
  const [card, setCard] = useState<LearningCardState | null>(null);
  const cardRef = useRef<LearningCardState | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const selectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPointerType = useRef('');
  const cache = useRef(new Map<string, string>());

  const close = useCallback(() => {
    sequence.current += 1;
    controller.current?.abort();
    controller.current = null;
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = null;
    cardRef.current = null;
    setCard(null);
  }, []);

  const update = useCallback((requestId: number, patch: Partial<LearningCardState>) => {
    if (sequence.current !== requestId || !cardRef.current) return;
    cardRef.current = { ...cardRef.current, ...patch };
    setCard(cardRef.current);
  }, []);

  const explain = useCallback(async (selection: LearningSelection, requestId: number, force = false) => {
    if (!articleId) return;
    const key = JSON.stringify([
      userId, articleId, selection.selectedText, selection.sentences,
      ai.model, ai.apiBaseUrl, ai.deepThinkingEnabled, ai.englishLearningPrompt,
    ]);
    const cached = cache.current.get(key);
    if (cached && !force) {
      update(requestId, { loading: false, explanation: cached });
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    try {
      const result = await requestEnglishExplanation(articleId, {
        selectedText: selection.selectedText, sentences: selection.sentences,
      }, abort.signal);
      if (sequence.current !== requestId || abort.signal.aborted) return;
      cache.current.set(key, result.explanation);
      if (cache.current.size > 100) {
        const oldest = cache.current.keys().next().value;
        if (oldest !== undefined) cache.current.delete(oldest);
      }
      update(requestId, { loading: false, explanation: result.explanation });
    } catch (error) {
      if (abort.signal.aborted) return;
      update(requestId, {
        loading: false,
        missingConfig: error instanceof ApiError && error.code === 'missing_ai_config',
        error: error instanceof Error ? error.message : '暂时无法生成讲解，请重试',
      });
    }
  }, [articleId, userId, ai.model, ai.apiBaseUrl, ai.deepThinkingEnabled, ai.englishLearningPrompt, update]);

  const openSelection = useCallback(() => {
    if (!enabled || !isDesktop || vocabularyOpen || !articleId || !contentRef.current ||
        !window.matchMedia('(any-pointer: fine)').matches) return;
    const selection = readLearningSelection(contentRef.current);
    if (!selection) return;
    const current = cardRef.current;
    if (current?.selection.selectedText === selection.selectedText &&
        JSON.stringify(current.selection.sentences) === JSON.stringify(selection.sentences) &&
        current.selection.rect.left === selection.rect.left && current.selection.rect.top === selection.rect.top) return;
    close();
    const requestId = sequence.current;
    const kind = selection.wordCount >= 4 ? 'sentence' : 'word';
    const tooLong = selection.selectedText.length > ENGLISH_LEARNING_MAX_TEXT_LENGTH ||
      selection.sentences.join('\n').length > ENGLISH_LEARNING_MAX_TEXT_LENGTH ||
      selection.sentences.length > 100 || (kind === 'word' && cleanVocabularyTerm(selection.selectedText).length > 200);
    const next: LearningCardState = {
      selection, articleId, userId, kind,
      loading: !tooLong, dictionary: null, explanation: '',
      error: tooLong ? '所选内容过长，请缩小选区' : '',
      missingConfig: false, saving: false, saved: false, invalidSelection: tooLong,
    };
    cardRef.current = next;
    setCard(next);
    if (tooLong) return;
    if (kind === 'sentence') {
      void explain(selection, requestId);
    } else {
      void lookupDictionary(selection.selectedText).then((dictionary) => {
        update(requestId, { dictionary, loading: false });
      });
    }
  }, [enabled, isDesktop, vocabularyOpen, articleId, contentRef, userId, close, explain, update]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    lastPointerType.current = event.pointerType;
    if (!enabled || !isDesktop || event.pointerType !== 'mouse' || event.button !== 0) return;
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    // 等待浏览器完成选区更新；双击的 pointerup 和 dblclick 合并为一次处理。
    selectionTimer.current = setTimeout(openSelection, 0);
  }, [enabled, isDesktop, openSelection]);

  const onDoubleClick = useCallback(() => {
    if (lastPointerType.current !== 'mouse') return;
    if (selectionTimer.current) clearTimeout(selectionTimer.current);
    selectionTimer.current = null;
    openSelection();
  }, [openSelection]);

  const retry = useCallback(() => {
    const current = cardRef.current;
    if (!current || current.loading || current.saving || current.invalidSelection) return;
    controller.current?.abort();
    const requestId = ++sequence.current;
    update(requestId, { loading: true, error: '', missingConfig: false });
    if (current.kind === 'sentence') {
      void explain(current.selection, requestId, true);
    } else {
      void lookupDictionary(current.selection.selectedText).then((dictionary) => {
        update(requestId, { loading: false, dictionary });
      });
    }
  }, [explain, update]);

  const saveWord = useCallback(async () => {
    const current = cardRef.current;
    if (!current || current.kind !== 'word' || current.saving || current.saved || current.loading || current.invalidSelection) return;
    const requestId = sequence.current;
    const abort = new AbortController();
    controller.current = abort;
    update(requestId, { saving: true, error: '' });
    try {
      await addVocabulary({
        articleId: current.articleId,
        term: cleanVocabularyTerm(current.selection.selectedText),
        definition: current.dictionary?.status === 'found' ? current.dictionary.entry.meanings.join('\n') : '',
        sourceSentence: current.selection.sentences.join('\n'),
      }, { notifyOnError: false }, abort.signal);
      update(requestId, { saving: false, saved: true });
    } catch (error) {
      if (abort.signal.aborted) return;
      update(requestId, { saving: false, error: error instanceof Error ? error.message : '保存失败，请重试' });
    }
  }, [update]);

  useEffect(() => {
    close();
    return close;
  }, [articleId, userId, contentHtml, enabled, isDesktop, vocabularyOpen,
    ai.model, ai.apiBaseUrl, ai.deepThinkingEnabled, ai.englishLearningPrompt, close]);

  useEffect(() => {
    cache.current.clear();
  }, [articleId, userId]);

  return {
    card: enabled && isDesktop && !vocabularyOpen && card && card.articleId === articleId && card.userId === userId ? card : null,
    close, retry, saveWord, onPointerUp, onDoubleClick,
  };
}
