import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Download, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  deleteDictionary,
  installCustomDictionary,
  installDictionary,
  listDictionaries,
  setDictionaryEnabled,
} from '@/lib/api/apiClient';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import type { DictionarySummary } from '@/types/dictionaries';
import {
  countReadyInstalledDictionaries,
  setInstalledDictionaryCount,
} from '@/lib/dictionaries/installedDictionaryCache';

const POLL_INTERVAL_MS = 1_200;

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCount(count: number): string {
  return count > 0 ? `${count.toLocaleString('zh-CN')} 条` : '—';
}

function progressPercent(item: DictionarySummary): number | null {
  if (item.totalBytes <= 0) return null;
  const ratio = item.downloadedBytes / item.totalBytes;
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}

function DictionaryItemCard({
  item,
  pending,
  canManage,
  onInstall,
  onRemove,
  onToggle,
}: {
  item: DictionarySummary;
  pending: boolean;
  canManage: boolean;
  onInstall: (id: string) => void;
  onRemove: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
}) {
  const installing = item.status === 'installing';
  const percent = installing ? progressPercent(item) : null;

  return (
    <li className="space-y-3 rounded-xl border border-border/65 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 break-words font-semibold">{item.name}</h3>
            {item.builtin ? <Badge variant="secondary">内置</Badge> : null}
            {!item.builtin && item.status === 'ready' ? (
              <Badge variant={item.enabled ? 'default' : 'outline'}>
                {item.enabled ? '已启用' : '已停用'}
              </Badge>
            ) : null}
            {item.status === 'error' ? <Badge variant="destructive">安装失败</Badge> : null}
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        </div>
        {canManage && !item.builtin && item.status === 'ready' ? (
          <Switch
            className="mt-1 shrink-0"
            checked={item.enabled}
            disabled={pending}
            aria-label={item.enabled ? `停用 ${item.name}` : `启用 ${item.name}`}
            onCheckedChange={(checked) => onToggle(item.id, checked)}
          />
        ) : null}
      </div>

      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1">
          <dt>词条</dt>
          <dd>{formatCount(item.entryCount || item.totalEntries)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>体积</dt>
          <dd>{formatBytes(item.totalBytes)}</dd>
        </div>
        <div className="flex gap-1">
          <dt>许可</dt>
          <dd>{item.license || '未标注'}</dd>
        </div>
      </dl>

      {installing ? (
        <div className="space-y-1.5" role="status" aria-live="polite">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full rounded-full bg-primary transition-[width] duration-500 ease-out',
                percent === null && 'w-1/3 animate-pulse',
              )}
              style={percent === null ? undefined : { width: `${percent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {item.downloadedBytes > 0 && (percent ?? 100) < 100
              ? `正在下载 ${formatBytes(item.downloadedBytes)} / ${formatBytes(item.totalBytes)}${percent === null ? '' : `（${percent}%）`}`
              : `正在导入词条${item.entryCount > 0 ? ` · 已导入 ${item.entryCount.toLocaleString('zh-CN')} 条` : ''}`}
          </p>
        </div>
      ) : null}

      {item.status === 'error' && item.error ? (
        <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-words">{item.error}</span>
        </p>
      ) : null}

      {item.attribution || item.homepage ? (
        <p className="break-words text-xs text-muted-foreground">
          {item.homepage ? (
            <a
              href={item.homepage}
              target="_blank"
              rel="noopener noreferrer"
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {item.attribution || item.homepage}
            </a>
          ) : (
            item.attribution
          )}
        </p>
      ) : null}

      {canManage && !item.builtin ? (
        <div className="flex flex-wrap gap-2">
          {item.status === 'available' ? (
            <Button size="sm" onClick={() => onInstall(item.id)} disabled={pending}>
              {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              下载
            </Button>
          ) : null}
          {item.status === 'error' ? (
            <Button size="sm" onClick={() => onInstall(item.id)} disabled={pending}>
              {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              重新下载
            </Button>
          ) : null}
          {item.status === 'ready' ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-primary" />已安装
            </span>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={pending}
            onClick={() => onRemove(item.id)}
          >
            {installing ? (
              <>取消下载</>
            ) : (
              <>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />删除
              </>
            )}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export default function DictionarySettingsPanel() {
  const canManage = useAuthStore((state) => state.currentUser?.role === 'admin');
  const [items, setItems] = useState<DictionarySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [customUrl, setCustomUrl] = useState('');
  const [customError, setCustomError] = useState('');
  const [customPending, setCustomPending] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const applyItems = useCallback((next: DictionarySummary[]) => {
    setItems(next);
    setInstalledDictionaryCount(countReadyInstalledDictionaries(next));
  }, []);

  const load = useCallback(async (options?: { silent?: boolean }) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (!options?.silent) setLoading(true);
    try {
      const result = await listDictionaries({ notifyOnError: false }, controller.signal);
      if (controller.signal.aborted) return;
      applyItems(result.items);
      setError('');
    } catch (err) {
      if (controller.signal.aborted) return;
      if (!options?.silent) setError(err instanceof Error ? err.message : '词典列表加载失败');
    } finally {
      if (!controller.signal.aborted && !options?.silent) setLoading(false);
    }
  }, [applyItems]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const installing = items.some((item) => item.status === 'installing');
  useEffect(() => {
    if (!installing) return;
    const timer = setInterval(() => { void load({ silent: true }); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [installing, load]);

  const runAction = useCallback(async (id: string, action: () => Promise<unknown>) => {
    setPendingId(id);
    setError('');
    try {
      await action();
      await load({ silent: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败，请重试');
    } finally {
      setPendingId(null);
    }
  }, [load]);

  const handleInstall = useCallback((id: string) => {
    void runAction(id, () => installDictionary(id, { notifyOnError: false }));
  }, [runAction]);

  const handleRemove = useCallback((id: string) => {
    void runAction(id, () => deleteDictionary(id, { notifyOnError: false }));
  }, [runAction]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    void runAction(id, () => setDictionaryEnabled(id, enabled, { notifyOnError: false }));
  }, [runAction]);

  const handleCustomImport = useCallback(async () => {
    const sourceUrl = customUrl.trim();
    if (!sourceUrl) {
      setCustomError('请输入词典文件的 http(s) 链接');
      return;
    }
    setCustomPending(true);
    setCustomError('');
    try {
      await installCustomDictionary(sourceUrl, { notifyOnError: false });
      setCustomUrl('');
      await load({ silent: true });
    } catch (err) {
      setCustomError(err instanceof Error ? err.message : '导入失败，请重试');
    } finally {
      setCustomPending(false);
    }
  }, [customUrl, load]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="space-y-4">
        <p className="text-sm leading-relaxed text-muted-foreground">
          内置词库随应用提供，无需下载。安装扩展词典后会优先生效，可随时停用或删除。
        </p>

        {loading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />正在加载词典列表…
          </div>
        ) : (
          <>
            {error ? (
              <div className="space-y-2">
                <p role="alert" className="text-sm text-destructive">{error}</p>
                <Button size="sm" variant="outline" onClick={() => { void load(); }}>重试</Button>
              </div>
            ) : null}
            <ul className="space-y-3">
              {items.map((item) => (
                <DictionaryItemCard
                  key={item.id}
                  item={item}
                  pending={pendingId === item.id}
                  canManage={canManage}
                  onInstall={handleInstall}
                  onRemove={handleRemove}
                  onToggle={handleToggle}
                />
              ))}
            </ul>
          </>
        )}

        {canManage ? (
          <div className="space-y-2 rounded-xl border border-dashed border-border/70 p-4">
            <h3 className="text-sm font-semibold">从链接导入</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">
              支持应用自身的 JSON 结构（<code>{'{ "word": { "meanings": ["释义"], "phonetic": "" } } }'}</code>）
              或 ECDICT 的 CSV。请自行确认来源的授权与准确性。
            </p>
            <Input
              aria-label="自定义词典链接"
              value={customUrl}
              placeholder="https://example.com/dictionary.json"
              onChange={(event) => { setCustomUrl(event.target.value); setCustomError(''); }}
              disabled={customPending}
            />
            {customError ? <p role="alert" className="text-sm text-destructive">{customError}</p> : null}
            <Button size="sm" variant="outline" onClick={() => { void handleCustomImport(); }} disabled={customPending}>
              {customPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
              导入
            </Button>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed border-border/70 p-4 text-xs leading-relaxed text-muted-foreground">
            词典由管理员统一管理，已启用的词典对所有账号生效。
          </p>
        )}
      </div>
    </div>
  );
}
