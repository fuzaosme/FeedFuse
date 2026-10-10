import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BookPlus, Check, Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { cleanVocabularyTerm } from '@/lib/englishLearning';
import { FLOATING_SURFACE_CLASS_NAME } from '@/lib/ui/designSystem';
import type { LearningCardState } from '../hooks/useEnglishLearning';

interface Props {
  card: LearningCardState;
  onClose: () => void;
  onRetry: () => void;
  onSave: () => void;
  onOpenSettings?: () => void;
}

const dictionaryMessages = {
  unconfigured: '暂未配置字典',
  not_found: '本地字典暂未收录这个单词或词组',
  error: '字典加载失败，请重试',
};

export default function EnglishLearningCard({ card, onClose, onRetry, onSave, onOpenSettings }: Props) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    const place = () => {
      const bounds = element.getBoundingClientRect();
      const anchor = card.selection.rect;
      const left = Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8));
      const below = anchor.bottom + 8;
      const preferredTop = below + bounds.height <= window.innerHeight - 8
        ? below : anchor.top - bounds.height - 8;
      const top = Math.max(8, Math.min(preferredTop, window.innerHeight - bounds.height - 8));
      setPosition((current) => current?.left === left && current.top === top ? current : { left, top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    return () => observer.disconnect();
  }, [card.selection]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !elementRef.current?.contains(event.target)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && elementRef.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const word = card.kind === 'word';
  const dictionary = card.dictionary;
  return createPortal(
    <div
      ref={elementRef}
      role="dialog"
      aria-modal="false"
      aria-label={word ? '单词释义' : '英语句子讲解'}
      className={cn(
        FLOATING_SURFACE_CLASS_NAME,
        'fixed z-50 max-h-[calc(100dvh-16px)] max-w-[calc(100vw-16px)] overflow-y-auto rounded-2xl p-4 shadow-xl',
        word ? 'w-[22rem]' : 'w-[30rem]',
      )}
      style={{ left: position?.left ?? 8, top: position?.top ?? 8, visibility: position ? 'visible' : 'hidden' }}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">{word ? '英语查词' : 'AI 句子讲解'}</p>
          {word ? <h2 className="break-words text-lg font-semibold">{cleanVocabularyTerm(card.selection.selectedText)}</h2> : null}
          {word && dictionary?.status === 'found' && dictionary.entry.phonetic ? (
            <p className="mt-1 text-sm text-muted-foreground">{dictionary.entry.phonetic}</p>
          ) : null}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="关闭学习卡片" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {word ? (
        <div className="space-y-3">
          {dictionary?.status === 'found' ? (
            <ul className="space-y-1 text-sm leading-relaxed">
              {dictionary.entry.meanings.map((meaning, index) => <li key={index}>{meaning}</li>)}
            </ul>
          ) : dictionary ? (
            <p className="text-sm text-muted-foreground">{dictionaryMessages[dictionary.status]}</p>
          ) : null}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">查看原句</summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{card.selection.sentences.join('\n')}</p>
          </details>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-2 rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">
            {card.selection.sentences.map((sentence, index) => <p key={index}>{sentence}</p>)}
          </div>
          {card.explanation ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{card.explanation}</p> : null}
        </div>
      )}

      {card.loading ? (
        <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />{word ? '正在查词…' : '正在生成讲解…'}
        </div>
      ) : null}
      {card.error ? <p role="alert" className="mt-3 text-sm text-destructive">{card.error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {word ? (
          <Button size="sm" variant="secondary" onClick={onSave} disabled={card.saving || card.saved || card.loading || card.invalidSelection}>
            {card.saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : card.saved ?
              <Check className="mr-1.5 h-4 w-4" /> : <BookPlus className="mr-1.5 h-4 w-4" />}
            {card.saved ? '已加入生词本' : card.saving ? '正在保存…' : '加入生词本'}
          </Button>
        ) : null}
        {card.missingConfig && onOpenSettings ? (
          <Button size="sm" onClick={() => { onClose(); onOpenSettings(); }}>打开设置</Button>
        ) : !card.invalidSelection && ((!word && card.error) || dictionary?.status === 'error') ? (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={card.loading || card.saving}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />重试
          </Button>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
