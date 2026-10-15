'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DefaultPromptDisclosureProps {
  /** 内置默认提示词原文：提示词输入框留空时，服务端实际使用的就是这段文本。 */
  prompt: string;
  /** 用户已填写自定义提示词时，内置模板当前不生效，需要如实标注。 */
  overridden?: boolean;
  className?: string;
}

/**
 * 内置默认提示词预览。
 *
 * 默认折叠成一行摘要，点击 `more` 才展开全文，避免长模板把设置页撑满；
 * 展开区域自身限高并滚动，长提示词也不会带动整页滚动。
 */
export default function DefaultPromptDisclosure({
  prompt,
  overridden = false,
  className,
}: DefaultPromptDisclosureProps) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  return (
    <div className={cn('mt-2 rounded-md border border-dashed border-border/80 bg-muted/30 px-3 py-2', className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          内置默认提示词{overridden ? '（已自定义，当前未生效）' : '（留空时生效）'}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 shrink-0 gap-1 px-2 text-xs"
          aria-expanded={expanded}
          aria-controls={contentId}
          aria-label={expanded ? '收起内置默认提示词 less' : '展开内置默认提示词 more'}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'less' : 'more'}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </Button>
      </div>
      {expanded ? (
        <div
          id={contentId}
          role="region"
          aria-label="内置默认提示词内容"
          className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-xs leading-relaxed text-muted-foreground"
        >
          {prompt}
        </div>
      ) : null}
    </div>
  );
}
