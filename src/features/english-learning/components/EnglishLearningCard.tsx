import { BookPlus, Check, Loader2, RotateCcw, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FLOATING_SURFACE_CLASS_NAME } from '@/lib/ui/designSystem';
import type { LearningCardState } from '../hooks/useEnglishLearning';

interface Props {
  card: LearningCardState;
  /** 同一次选区出现多张卡片时限制高度，避免整叠卡片超出视口。 */
  stacked?: boolean;
  /** 关闭整组卡片（例如跳转设置中心前）。 */
  onClose: () => void;
  /** 只关闭当前这张卡片。 */
  onDismiss: () => void;
  onRetry: () => void;
  onSave: () => void;
  /** 单词卡「详细解释」：词典读不懂时用专用提示词深挖语境用法。 */
  onExplainDetail: () => void;
  /** 单词卡「详细解释」重新生成：绕过缓存强制重跑，废回答可覆盖。 */
  onRetryDetail: () => void;
  onOpenSettings?: () => void;
}

const dictionaryMessages = {
  unconfigured: '暂未配置字典',
  not_found: '本地字典暂未收录这个单词或词组',
  error: '字典加载失败，请重试',
};

export default function EnglishLearningCard({
  card, stacked = false, onClose, onDismiss, onRetry, onSave, onExplainDetail, onRetryDetail, onOpenSettings,
}: Props) {
  const word = card.kind === 'word';
  const dictionary = card.dictionary;
  const showSettings = card.missingConfig || card.detailMissingConfig;
  // 句子讲解失败 → 重试；成功但不满意（例如曾外露思维链的废回答）→ 重新生成（绕缓存）。
  const showSentenceRetry = !word && !card.invalidSelection && !showSettings && card.error;
  const showSentenceRegen = !word && !card.invalidSelection && !showSettings && !card.error && !!card.explanation;
  // 词典失败 → 重试词典；详细解释失败 → 重试详细解释；已有详细解释 → 可重新生成覆盖。
  const showDictionaryRetry = word && !card.invalidSelection && !showSettings && dictionary?.status === 'error';
  const showDetailRetry = word && !card.invalidSelection && !card.detailMissingConfig &&
    !!card.detailError;
  const showDetailRegen = word && !card.invalidSelection && !card.detailMissingConfig &&
    !card.detailError && !!card.detailText;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={word ? `单词释义：${card.term}` : '英语句子讲解'}
      className={cn(
        FLOATING_SURFACE_CLASS_NAME,
        'max-w-full shrink-0 overflow-y-auto rounded-2xl p-4 shadow-xl',
        word ? 'w-[22rem]' : 'w-[30rem]',
        stacked ? 'max-h-[calc(50dvh-16px)]' : 'max-h-[calc(100dvh-16px)]',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-muted-foreground">{word ? '英语查词' : 'AI 句子讲解'}</p>
          {word ? <h2 className="break-words text-lg font-semibold">{card.term}</h2> : null}
          {word && dictionary?.status === 'found' && dictionary.entry.phonetic ? (
            <p className="mt-1 text-sm text-muted-foreground">{dictionary.entry.phonetic}</p>
          ) : null}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="关闭学习卡片" onClick={onDismiss}>
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
          {card.detailText ? (
            <div className="rounded-xl border border-border/70 bg-muted/40 p-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">AI 详细解释</p>
              <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{card.detailText}</p>
            </div>
          ) : null}
          {card.detailError ? <p role="alert" className="text-sm text-destructive">{card.detailError}</p> : null}
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
      {card.detailLoading ? (
        <div role="status" className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />正在生成详细解释…
        </div>
      ) : null}
      {card.error ? <p role="alert" className="mt-3 text-sm text-destructive">{card.error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {word ? (
          <>
            <Button size="sm" variant="secondary" onClick={onSave} disabled={card.saving || card.saved || card.loading || card.invalidSelection}>
              {card.saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : card.saved ?
                <Check className="mr-1.5 h-4 w-4" /> : <BookPlus className="mr-1.5 h-4 w-4" />}
              {card.saved ? '已加入生词本' : card.saving ? '正在保存…' : '加入生词本'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-7 px-0"
              title="详细解释"
              aria-label="详细解释"
              onClick={onExplainDetail}
              disabled={card.detailLoading || card.loading || card.saving || card.invalidSelection}
            >
              {card.detailLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            </Button>
          </>
        ) : null}
        {showSettings ? (
          onOpenSettings ? <Button size="sm" onClick={() => { onClose(); onOpenSettings(); }}>打开设置</Button> : null
        ) : (
          <>
            {showSentenceRetry || showDictionaryRetry ? (
              <Button size="sm" variant="outline" onClick={onRetry} disabled={card.loading || card.saving}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />重试
              </Button>
            ) : null}
            {showDetailRetry ? (
              <Button size="sm" variant="outline" onClick={onRetryDetail} disabled={card.detailLoading || card.loading || card.saving}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />重试详细解释
              </Button>
            ) : null}
            {showSentenceRegen ? (
              <Button size="sm" variant="ghost" onClick={onRetry} disabled={card.loading || card.saving}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />重新生成
              </Button>
            ) : null}
            {showDetailRegen ? (
              <Button size="sm" variant="ghost" onClick={onRetryDetail} disabled={card.detailLoading || card.loading || card.saving}>
                <RotateCcw className="mr-1.5 h-3.5 w-3.5" />重新生成解释
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
