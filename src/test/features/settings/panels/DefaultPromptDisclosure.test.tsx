import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DefaultPromptDisclosure from '@/features/settings/components/DefaultPromptDisclosure';

const LONG_PROMPT = `第一段说明\n${'很长的提示词内容。'.repeat(50)}`;

describe('DefaultPromptDisclosure', () => {
  it('默认折叠，点击 more 才展示完整内置提示词', () => {
    render(<DefaultPromptDisclosure prompt={LONG_PROMPT} />);

    expect(screen.getByText('内置默认提示词（留空时生效）')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '内置默认提示词内容' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开内置默认提示词 more' }));

    const region = screen.getByRole('region', { name: '内置默认提示词内容' });
    expect(region).toHaveTextContent('第一段说明');
    expect(screen.getByRole('button', { name: '收起内置默认提示词 less' })).toBeInTheDocument();
  });

  it('点击 less 收起全文', () => {
    render(<DefaultPromptDisclosure prompt={LONG_PROMPT} />);

    fireEvent.click(screen.getByRole('button', { name: '展开内置默认提示词 more' }));
    fireEvent.click(screen.getByRole('button', { name: '收起内置默认提示词 less' }));

    expect(screen.queryByRole('region', { name: '内置默认提示词内容' })).not.toBeInTheDocument();
  });

  it('已自定义提示词时标注内置模板当前未生效', () => {
    render(<DefaultPromptDisclosure prompt={LONG_PROMPT} overridden />);

    expect(screen.getByText('内置默认提示词（已自定义，当前未生效）')).toBeInTheDocument();
  });
});
