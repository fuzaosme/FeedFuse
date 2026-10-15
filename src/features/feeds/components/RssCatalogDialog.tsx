import { useMemo, useState } from 'react';
import { Check, ExternalLink, Plus, Rss, Search } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { RSS_CATALOG, RSS_DIRECTORIES, normalizeCatalogFeedUrl, type RssCatalogEntry } from '../data/rssCatalog';

interface RssCatalogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscribedUrls: string[];
  onSelect: (entry: RssCatalogEntry) => void;
}

const categories = ['全部', ...new Set(RSS_CATALOG.map((entry) => entry.category))];

export default function RssCatalogDialog({ open, onOpenChange, subscribedUrls, onSelect }: RssCatalogDialogProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [language, setLanguage] = useState('全部语言');
  const subscribed = useMemo(() => new Set(subscribedUrls.map(normalizeCatalogFeedUrl)), [subscribedUrls]);
  const entries = useMemo(() => {
    const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return RSS_CATALOG.filter((entry) => {
      const text = `${entry.title} ${entry.description} ${entry.category} ${entry.language} ${entry.url}`.toLowerCase();
      return (category === '全部' || entry.category === category) &&
        (language === '全部语言' || entry.language === language) && keywords.every((word) => text.includes(word));
    });
  }, [query, category, language]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel="关闭 RSS 列表" className="flex max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl flex-col gap-4 overflow-hidden p-5 sm:p-6">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2"><Rss className="h-5 w-5 text-primary" />RSS 列表</DialogTitle>
          <DialogDescription className="leading-relaxed">
            RSS 就像网站的更新订阅。添加你感兴趣的来源，新文章会自动出现在 FeedFuse，无需逐个打开网站。
          </DialogDescription>
        </DialogHeader>
        <div className="shrink-0 space-y-3">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input aria-label="搜索 RSS 来源" placeholder="搜索名称、主题或网址…" value={query} onChange={(event) => setQuery(event.target.value)} className="pl-9" />
            </div>
            <select aria-label="筛选来源语言" value={language} onChange={(event) => setLanguage(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {['全部语言', '中文', '英文'].map((item) => <option key={item}>{item}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="来源分类">
            {categories.map((item) => (
              <button key={item} type="button" aria-pressed={category === item} onClick={() => setCategory(item)} className={cn('rounded-full px-3 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', category === item ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}>
                {item}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground" role="status">{entries.length} 个来源 · 选择后可确认名称与分类</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
          <ul className="grid gap-2 sm:grid-cols-2" aria-label="RSS 来源">
            {entries.map((entry) => {
              const alreadyAdded = subscribed.has(normalizeCatalogFeedUrl(entry.url));
              return (
                <li key={entry.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-border/70 bg-card/40 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <a href={entry.siteUrl} target="_blank" rel="noopener noreferrer" className="min-w-0 break-words text-sm font-medium underline-offset-4 hover:underline">{entry.title}<ExternalLink aria-hidden="true" className="ml-1 inline h-3 w-3 text-muted-foreground" /></a>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{entry.language}</span>
                  </div>
                  <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{entry.description}</p>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">{entry.category}</span>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={alreadyAdded} aria-label={alreadyAdded ? `已添加 ${entry.title}` : `添加 ${entry.title}`} onClick={() => onSelect(entry)}>
                      {alreadyAdded ? <Check className="h-3 w-3" /> : <Plus className="h-3 w-3" />}{alreadyAdded ? '已添加' : '添加'}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          {entries.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">没有找到匹配的来源，试试其他关键词或分类。</p> : null}
          <div className="mt-5 space-y-2 border-t border-border/60 pt-4">
            <h3 className="text-sm font-medium">寻找更多 RSS</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">这些公开目录收录了更多来源。找到 RSS 地址后，可通过“添加 RSS 源”订阅。</p>
            <div className="space-y-2">
              {RSS_DIRECTORIES.map((directory) => (
                <a key={directory.url} href={directory.url} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-muted/50 px-3 py-2 hover:bg-muted">
                  <span className="text-xs font-medium">{directory.title}<ExternalLink aria-hidden="true" className="ml-1 inline h-3 w-3" /></span>
                  <p className="mt-0.5 text-xs text-muted-foreground">{directory.description}</p>
                </a>
              ))}
            </div>
            <p className="pt-1 text-[11px] leading-relaxed text-muted-foreground">列表整理于 2026-10-15，汇总自公开 RSS 清单，新增地址未经逐一验证。部分网站仅提供摘要，阅读全文可能需要登录或订阅。</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
