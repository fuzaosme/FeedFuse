import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionarySummary } from '@/types/dictionaries';

const listDictionariesMock = vi.fn();
const installDictionaryMock = vi.fn();
const installCustomDictionaryMock = vi.fn();
const setDictionaryEnabledMock = vi.fn();
const deleteDictionaryMock = vi.fn();

vi.mock('@/lib/api/apiClient', () => ({
  listDictionaries: (...args: unknown[]) => listDictionariesMock(...args),
  installDictionary: (...args: unknown[]) => installDictionaryMock(...args),
  installCustomDictionary: (...args: unknown[]) => installCustomDictionaryMock(...args),
  setDictionaryEnabled: (...args: unknown[]) => setDictionaryEnabledMock(...args),
  deleteDictionary: (...args: unknown[]) => deleteDictionaryMock(...args),
}));

import DictionarySettingsPanel from '@/features/settings/panels/DictionarySettingsPanel';
import { useAuthStore } from '@/store/authStore';

function summary(patch: Partial<DictionarySummary> = {}): DictionarySummary {
  return {
    id: 'ecdict-full',
    name: 'ECDICT 完整版',
    description: '完整词库',
    language: 'en-zh',
    license: 'MIT',
    attribution: 'ECDICT · MIT License',
    homepage: 'https://github.com/skywind3000/ECDICT',
    builtin: false,
    enabled: true,
    status: 'available',
    error: '',
    entryCount: 0,
    totalEntries: 768_610,
    totalBytes: 65_936_699,
    downloadedBytes: 0,
    installedAt: null,
    updatedAt: null,
    ...patch,
  };
}

const builtin = summary({
  id: 'builtin-ecdict-core',
  name: '内置核心词库',
  builtin: true,
  status: 'ready',
  entryCount: 29_005,
  totalEntries: 29_005,
  totalBytes: 2_910_651,
  downloadedBytes: 2_910_651,
});

beforeEach(() => {
  for (const mock of [
    listDictionariesMock, installDictionaryMock, installCustomDictionaryMock,
    setDictionaryEnabledMock, deleteDictionaryMock,
  ]) mock.mockReset();
  useAuthStore.setState({ currentUser: { id: '1', role: 'admin' } });
  listDictionariesMock.mockResolvedValue({ items: [builtin, summary()] });
  installDictionaryMock.mockResolvedValue({ item: summary({ status: 'installing' }) });
  installCustomDictionaryMock.mockResolvedValue({ item: summary({ id: 'custom-1' }) });
  setDictionaryEnabledMock.mockResolvedValue({ item: summary({ enabled: false }) });
  deleteDictionaryMock.mockResolvedValue({ deleted: true });
});

describe('DictionarySettingsPanel', () => {
  it('展示内置词典与可下载词典', async () => {
    render(<DictionarySettingsPanel />);

    expect(await screen.findByText('内置核心词库')).toBeInTheDocument();
    expect(screen.getByText('内置')).toBeInTheDocument();
    expect(screen.getByText('29,005 条')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下载/ })).toBeInTheDocument();
    expect(screen.getAllByText('ECDICT · MIT License').length).toBeGreaterThan(0);
  });

  it('内置词典不提供下载和删除按钮', async () => {
    listDictionariesMock.mockResolvedValue({ items: [builtin] });
    render(<DictionarySettingsPanel />);

    await screen.findByText('内置核心词库');
    expect(screen.queryByRole('button', { name: /下载/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
  });

  it('点击下载会调用安装接口并刷新列表', async () => {
    render(<DictionarySettingsPanel />);
    await screen.findByText('ECDICT 完整版');

    fireEvent.click(screen.getByRole('button', { name: /下载/ }));

    await waitFor(() => expect(installDictionaryMock).toHaveBeenCalledWith('ecdict-full', { notifyOnError: false }));
    await waitFor(() => expect(listDictionariesMock).toHaveBeenCalledTimes(2));
  });

  it('安装中展示进度并允许取消', async () => {
    listDictionariesMock.mockResolvedValue({
      items: [builtin, summary({
        status: 'installing',
        downloadedBytes: 32_968_349,
        totalBytes: 65_936_699,
      })],
    });
    render(<DictionarySettingsPanel />);

    await screen.findByText('ECDICT 完整版');
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('正在下载');
    expect(status).toHaveTextContent('50%');

    fireEvent.click(screen.getByRole('button', { name: '取消下载' }));
    await waitFor(() => expect(deleteDictionaryMock).toHaveBeenCalledWith('ecdict-full', { notifyOnError: false }));
  });

  it('已安装词典可以停用和删除', async () => {
    listDictionariesMock.mockResolvedValue({ items: [builtin, summary({ status: 'ready', entryCount: 768_610 })] });
    render(<DictionarySettingsPanel />);

    await screen.findByText('ECDICT 完整版');
    expect(screen.getByText('已安装')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: '停用 ECDICT 完整版' }));
    await waitFor(() => expect(setDictionaryEnabledMock).toHaveBeenCalledWith('ecdict-full', false, { notifyOnError: false }));

    fireEvent.click(screen.getByRole('button', { name: /删除/ }));
    await waitFor(() => expect(deleteDictionaryMock).toHaveBeenCalledWith('ecdict-full', { notifyOnError: false }));
  });

  it('安装失败时展示错误并允许重试', async () => {
    listDictionariesMock.mockResolvedValue({
      items: [builtin, summary({ status: 'error', error: '词典下载失败：HTTP 404' })],
    });
    render(<DictionarySettingsPanel />);

    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 404');
    fireEvent.click(screen.getByRole('button', { name: /重新下载/ }));
    await waitFor(() => expect(installDictionaryMock).toHaveBeenCalledWith('ecdict-full', { notifyOnError: false }));
  });

  it('可以从链接导入自定义词典', async () => {
    render(<DictionarySettingsPanel />);
    await screen.findByText('内置核心词库');

    fireEvent.change(screen.getByLabelText('自定义词典链接'), {
      target: { value: 'https://example.com/dict.json' },
    });
    fireEvent.click(screen.getByRole('button', { name: /导入/ }));

    await waitFor(() => expect(installCustomDictionaryMock).toHaveBeenCalledWith(
      'https://example.com/dict.json',
      { notifyOnError: false },
    ));
  });

  it('非管理员只能查看词典，不能下载或删除', async () => {
    useAuthStore.setState({ currentUser: { id: '2', role: 'member' } });
    listDictionariesMock.mockResolvedValue({ items: [builtin, summary({ status: 'ready', entryCount: 768_610 })] });
    render(<DictionarySettingsPanel />);

    await screen.findByText('ECDICT 完整版');
    expect(screen.queryByRole('button', { name: /下载/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /删除/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText(/词典由管理员统一管理/)).toBeInTheDocument();
  });

  it('空链接不会发起导入', async () => {
    render(<DictionarySettingsPanel />);
    await screen.findByText('内置核心词库');

    fireEvent.click(screen.getByRole('button', { name: /导入/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent('请输入词典文件的 http(s) 链接');
    expect(installCustomDictionaryMock).not.toHaveBeenCalled();
  });
});
