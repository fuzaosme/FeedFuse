import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RssCatalogDialog from '@/features/feeds/components/RssCatalogDialog';
import { RSS_CATALOG } from '@/features/feeds/data/rssCatalog';

// 保留中英文和多个分类的真实条目，聚焦搜索、筛选与选择行为。
vi.mock('@/features/feeds/data/rssCatalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/feeds/data/rssCatalog')>();
  return { ...actual, RSS_CATALOG: actual.RSS_CATALOG.filter((entry) => ['sspai', 'nasa', 'hn'].includes(entry.id)) };
});

describe('RSS catalog', () => {
  it('支持组合搜索、分类和语言筛选，并能恢复全部结果', () => {
    render(<RssCatalogDialog open onOpenChange={vi.fn()} subscribedUrls={[]} onSelect={vi.fn()} />);
    expect(screen.getByText(`${RSS_CATALOG.length} 个来源 · 选择后可确认名称与分类`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('筛选来源语言'), { target: { value: '英文' } });
    fireEvent.click(screen.getByText('科学探索', { selector: 'button' }));
    fireEvent.change(screen.getByLabelText('搜索 RSS 来源'), { target: { value: 'NASA' } });
    const nasaCount = RSS_CATALOG.filter((entry) => entry.language === '英文' && entry.category === '科学探索' &&
      `${entry.title} ${entry.description} ${entry.category} ${entry.language} ${entry.url}`.toLowerCase().includes('nasa')).length;
    expect(screen.getByRole('status')).toHaveTextContent(`${nasaCount} 个来源`);
    expect(screen.getByRole('button', { name: '添加 NASA' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索 RSS 来源'), { target: { value: 'no-such-feed' } });
    expect(screen.getByText(/没有找到匹配的来源/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索 RSS 来源'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '全部', exact: true }));
    fireEvent.change(screen.getByLabelText('筛选来源语言'), { target: { value: '全部语言' } });
    expect(screen.getByText(`${RSS_CATALOG.length} 个来源 · 选择后可确认名称与分类`)).toBeInTheDocument();
  });

  it('标记已有订阅，未添加来源带完整地址进入添加流程', () => {
    const onSelect = vi.fn();
    render(<RssCatalogDialog open onOpenChange={vi.fn()} subscribedUrls={['https://sspai.com/feed/']} onSelect={onSelect} />);
    expect(screen.getByLabelText('已添加 少数派')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('添加 NASA'));
    expect(onSelect).toHaveBeenCalledWith(RSS_CATALOG.find((entry) => entry.id === 'nasa'));
    expect(screen.getByText('Awesome RSS Feeds').closest('a')).toHaveAttribute('target', '_blank');
    expect(screen.getByText('中文独立博客')).toBeInTheDocument();
  });
});
