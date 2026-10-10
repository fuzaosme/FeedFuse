import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Loader2, Pencil, Search, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { deleteVocabulary, listVocabulary, patchVocabulary } from '@/lib/api/apiClient';
import { FROSTED_HEADER_CLASS_NAME } from '@/lib/ui/designSystem';
import { normalizeVocabularyTerm } from '@/lib/englishLearning';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { VocabularyEntry } from '@/types';

function VocabularyItem({ entry, onUpdate, onDelete }: {
  entry: VocabularyEntry;
  onUpdate: (entry: VocabularyEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [definition, setDefinition] = useState(entry.definition);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const mutate = async (action: 'save' | 'delete') => {
    if (pending) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true);
    setError('');
    try {
      if (action === 'save') {
        const result = await patchVocabulary(entry.id, definition, { notifyOnError: false }, controller.signal);
        if (controller.signal.aborted) return;
        onUpdate(result.entry);
        setDefinition(result.entry.definition);
        setEditing(false);
      } else {
        await deleteVocabulary(entry.id, { notifyOnError: false }, controller.signal);
        if (controller.signal.aborted) return;
        onDelete(entry.id);
      }
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };

  return (
    <li className="space-y-3 rounded-xl border border-border/65 bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="min-w-0 break-words font-semibold">{entry.term}</h3>
        <div className="flex shrink-0 gap-1">
          <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`编辑 ${entry.term} 的释义`} disabled={pending}
            onClick={() => { setDefinition(entry.definition); setEditing(true); setError(''); }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive"
            aria-label={`删除 ${entry.term}`} disabled={pending} onClick={() => { void mutate('delete'); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-2">
          <Textarea aria-label={`${entry.term} 的中文释义`} value={definition} maxLength={10_000} disabled={pending}
            onChange={(event) => setDefinition(event.target.value)} placeholder="填写中文释义或学习笔记…" className="min-h-24" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => { void mutate('save'); }} disabled={pending}>
              {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}保存释义
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setEditing(false); setError(''); }}>取消</Button>
          </div>
        </div>
      ) : entry.definition ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{entry.definition}</p>
      ) : (
        <button type="button" className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => setEditing(true)}>补充中文释义</button>
      )}
      <blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary/25 pl-3 text-sm leading-relaxed text-muted-foreground">
        {entry.sourceSentence}
      </blockquote>
      {/^https?:\/\//i.test(entry.sourceUrl) ? (
        <a href={entry.sourceUrl} target="_blank" rel="noopener noreferrer"
          className="block truncate text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
          {entry.sourceTitle}
        </a>
      ) : <p className="truncate text-xs text-muted-foreground">{entry.sourceTitle}</p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </li>
  );
}

function VocabularyContent() {
  const [items, setItems] = useState<VocabularyEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const result = await listVocabulary({ notifyOnError: false }, controller.signal);
      if (!controller.signal.aborted) setItems(result.items);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '生词本加载失败');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const filtered = useMemo(() => {
    const termQuery = normalizeVocabularyTerm(query);
    const textQuery = query.trim().toLowerCase();
    if (!textQuery) return items;
    return items.filter((entry) =>
      (termQuery && entry.normalizedTerm.includes(termQuery)) ||
      entry.definition.toLowerCase().includes(textQuery) ||
      entry.sourceSentence.toLowerCase().includes(textQuery) ||
      entry.sourceTitle.toLowerCase().includes(textQuery),
    );
  }, [items, query]);

  return (
    <>
      <div className="border-b border-border/60 px-5 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="搜索生词本" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索单词、释义或原句…" className="pl-9" />
        </div>
        {!loading && !error ? <p className="mt-2 text-xs text-muted-foreground">{query.trim() ? `${filtered.length} 条匹配 · ` : ''}共 {items.length} 个词条</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />正在加载生词本…
          </div>
        ) : error ? (
          <div className="space-y-3 py-6 text-center">
            <p role="alert" className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="outline" onClick={() => { void load(); }}>重试</Button>
          </div>
        ) : filtered.length ? (
          <ul className="space-y-3">
            {filtered.map((entry) => <VocabularyItem key={entry.id} entry={entry}
              onUpdate={(updated) => setItems((current) => current.map((item) => item.id === updated.id ? updated : item))}
              onDelete={(id) => setItems((current) => current.filter((item) => item.id !== id))} />)}
          </ul>
        ) : (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {query.trim() ? '没有匹配的词条' : '开启英语学习模式，在查词卡片中加入第一个生词。'}
          </p>
        )}
      </div>
    </>
  );
}

export default function VocabularyDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const userId = useAuthStore((state) => state.currentUser?.id);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg" closeLabel="关闭生词本">
        <div className={cn(FROSTED_HEADER_CLASS_NAME, 'px-5 pb-4 pt-5 pr-12')}>
          <SheetTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" />生词本</SheetTitle>
          <SheetDescription className="mt-1.5">保存阅读中遇到的单词和词组，随时补充释义。</SheetDescription>
        </div>
        {open ? <VocabularyContent key={userId ?? 'anonymous'} /> : null}
      </SheetContent>
    </Sheet>
  );
}
