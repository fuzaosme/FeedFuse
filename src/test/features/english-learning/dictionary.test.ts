import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DictionarySummary } from '@/types/dictionaries';

const listDictionariesMock = vi.fn();
const lookupServerDictionaryMock = vi.fn();

vi.mock('@/lib/api/apiClient', () => ({
  listDictionaries: (...args: unknown[]) => listDictionariesMock(...args),
  lookupServerDictionary: (...args: unknown[]) => lookupServerDictionaryMock(...args),
}));

function dictionarySummary(patch: Partial<DictionarySummary> = {}): DictionarySummary {
  return {
    id: 'ecdict-full',
    name: 'ECDICT 完整版',
    description: '',
    language: 'en-zh',
    license: 'MIT',
    attribution: '',
    homepage: '',
    builtin: false,
    enabled: true,
    status: 'ready',
    error: '',
    entryCount: 768_610,
    totalEntries: 768_610,
    totalBytes: 0,
    downloadedBytes: 0,
    installedAt: null,
    updatedAt: null,
    ...patch,
  };
}

function mockLocalDictionary(entries: Record<string, unknown>) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(entries), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as unknown as typeof fetch;
}

async function loadDictionaryModule(count: number | null = 0) {
  vi.resetModules();
  const state = await import('@/lib/dictionaries/installedDictionaryCache');
  if (count !== null) state.setInstalledDictionaryCount(count);
  return import('@/features/english-learning/utils/dictionary');
}

beforeEach(() => {
  listDictionariesMock.mockReset();
  lookupServerDictionaryMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('lookupDictionary', () => {
  it('未收录结果到期后重新查询，避免同数量词典替换后的永久旧缓存', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
    mockLocalDictionary({ fuse: { meanings: ['保险丝'] } });
    lookupServerDictionaryMock.mockResolvedValue({ result: { status: 'not_found' } });
    const { lookupDictionary } = await loadDictionaryModule(1);
    await lookupDictionary('rareword');
    await lookupDictionary('rareword');
    expect(lookupServerDictionaryMock).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    lookupServerDictionaryMock.mockResolvedValue({ result: {
      status: 'found', dictionaryId: 'updated', entry: { meanings: ['新词条'] },
    } });
    expect(await lookupDictionary('rareword')).toMatchObject({ dictionaryId: 'updated' });
    expect(lookupServerDictionaryMock).toHaveBeenCalledTimes(2);
  });

  it('安装状态未知或刷新缓慢时直接查服务端，不等待列表', async () => {
    mockLocalDictionary({});
    listDictionariesMock.mockReturnValue(new Promise(() => {}));
    lookupServerDictionaryMock.mockResolvedValue({ result: {
      status: 'found', dictionaryId: 'custom', entry: { meanings: ['自定义'] },
    } });
    const { lookupDictionary } = await loadDictionaryModule(null);
    expect(await lookupDictionary('fuse')).toMatchObject({ dictionaryId: 'custom' });
    expect(listDictionariesMock).toHaveBeenCalledTimes(1);
  });

  it('状态过期时沿用已有安装数量，同时后台刷新', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-15T00:00:00Z'));
    mockLocalDictionary({ fuse: { meanings: ['内置'] } });
    listDictionariesMock.mockReturnValue(new Promise(() => {}));
    const { lookupDictionary } = await loadDictionaryModule(0);
    vi.advanceTimersByTime(60_001);
    expect(await lookupDictionary('fuse')).toMatchObject({ dictionaryId: 'builtin-ecdict-core' });
    expect(listDictionariesMock).toHaveBeenCalledTimes(1);
    expect(lookupServerDictionaryMock).not.toHaveBeenCalled();
  });

  it('面板同步后同词旧缓存失效，即使启用词典数量相同', async () => {
    mockLocalDictionary({});
    lookupServerDictionaryMock.mockResolvedValue({ result: {
      status: 'found', dictionaryId: 'old', entry: { meanings: ['旧释义'] },
    } });
    const { lookupDictionary } = await loadDictionaryModule(1);
    await lookupDictionary('fuse');
    const { setInstalledDictionaryCount } = await import('@/lib/dictionaries/installedDictionaryCache');
    setInstalledDictionaryCount(1);
    lookupServerDictionaryMock.mockResolvedValue({ result: {
      status: 'found', dictionaryId: 'new', entry: { meanings: ['新释义'] },
    } });
    expect(await lookupDictionary('fuse')).toMatchObject({ dictionaryId: 'new' });
    expect(lookupServerDictionaryMock).toHaveBeenCalledTimes(2);
  });

  it('旧列表请求返回时不能覆盖面板更新的安装状态', async () => {
    let resolveList!: (value: { items: DictionarySummary[] }) => void;
    listDictionariesMock.mockReturnValue(new Promise((resolve) => { resolveList = resolve; }));
    await loadDictionaryModule(null);
    const state = await import('@/lib/dictionaries/installedDictionaryCache');
    const pending = state.getInstalledDictionaryCount();
    state.setInstalledDictionaryCount(1);
    resolveList({ items: [] });
    await pending;
    expect(state.getInstalledDictionarySnapshot().count).toBe(1);
  });

  it('短语候选由服务端处理，只发一次查词请求', async () => {
    mockLocalDictionary({});
    lookupServerDictionaryMock.mockResolvedValue({ result: { status: 'not_found' } });
    const { lookupDictionary } = await loadDictionaryModule(1);
    await lookupDictionary('unknown phrase here');
    expect(lookupServerDictionaryMock).toHaveBeenCalledTimes(1);
  });

  it('服务端超时后使用预热的核心词典，恢复后不沿用故障回退缓存', async () => {
    vi.useFakeTimers();
    mockLocalDictionary({ fuse: { meanings: ['内置'] } });
    lookupServerDictionaryMock.mockImplementation((_term, _options, signal: AbortSignal) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    );
    const { lookupDictionary, DICTIONARY_LOOKUP_TIMEOUT_MS } = await loadDictionaryModule(1);
    // 使用受控信号，让测试计时器能驱动 AbortSignal.timeout。
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const pending = lookupDictionary('fuse');
    await vi.advanceTimersByTimeAsync(DICTIONARY_LOOKUP_TIMEOUT_MS);
    expect(await pending).toMatchObject({ dictionaryId: 'builtin-ecdict-core' });
    lookupServerDictionaryMock.mockResolvedValue({ result: {
      status: 'found', dictionaryId: 'custom', entry: { meanings: ['自定义'] },
    } });
    expect(await lookupDictionary('fuse')).toMatchObject({ dictionaryId: 'custom' });
  });

  it('命中内置词库时不再请求接口', async () => {
    mockLocalDictionary({ fuse: { meanings: ['保险丝'], phonetic: 'fju:z' } });
    listDictionariesMock.mockResolvedValue({ items: [dictionarySummary({ builtin: true, id: 'builtin' })] });
    const { lookupDictionary } = await loadDictionaryModule();

    const result = await lookupDictionary('Fuse');

    expect(result).toEqual({
      status: 'found',
      dictionaryId: 'builtin-ecdict-core',
      entry: { meanings: ['保险丝'], phonetic: 'fju:z' },
    });
    expect(lookupServerDictionaryMock).not.toHaveBeenCalled();
  });

  it('内置未收录时回退到服务端扩展词典', async () => {
    mockLocalDictionary({ fuse: { meanings: ['保险丝'] } });
    listDictionariesMock.mockResolvedValue({ items: [] });
    lookupServerDictionaryMock.mockResolvedValue({
      result: {
        status: 'found',
        dictionaryId: 'ecdict-full',
        entry: { meanings: ['偶然发现珍宝的运气'] },
      },
    });
    const { lookupDictionary } = await loadDictionaryModule();

    const result = await lookupDictionary('serendipity');

    expect(result).toMatchObject({ status: 'found', dictionaryId: 'ecdict-full' });
  });

  it('已安装词典时优先使用服务端结果', async () => {
    mockLocalDictionary({ fuse: { meanings: ['内置释义'] } });
    listDictionariesMock.mockResolvedValue({ items: [dictionarySummary()] });
    lookupServerDictionaryMock.mockResolvedValue({
      result: { status: 'found', dictionaryId: 'custom-1', entry: { meanings: ['自定义释义'] } },
    });
    const { lookupDictionary } = await loadDictionaryModule(1);

    const result = await lookupDictionary('fuse');

    expect(result).toMatchObject({ status: 'found', dictionaryId: 'custom-1' });
    expect(lookupServerDictionaryMock).toHaveBeenCalledWith('fuse', { notifyOnError: false }, expect.any(AbortSignal));
  });

  it('服务端未收录时回退内置词库', async () => {
    mockLocalDictionary({ fuse: { meanings: ['内置释义'] } });
    listDictionariesMock.mockResolvedValue({ items: [dictionarySummary()] });
    lookupServerDictionaryMock.mockResolvedValue({ result: { status: 'not_found' } });
    const { lookupDictionary } = await loadDictionaryModule(1);

    const result = await lookupDictionary('fuse');

    expect(result).toMatchObject({ status: 'found', dictionaryId: 'builtin-ecdict-core' });
  });

  it('接口不可用时仍返回内置结果', async () => {
    mockLocalDictionary({ fuse: { meanings: ['内置释义'] } });
    listDictionariesMock.mockRejectedValue(new Error('network'));
    lookupServerDictionaryMock.mockRejectedValue(new Error('network'));
    const { lookupDictionary } = await loadDictionaryModule();

    expect(await lookupDictionary('fuse')).toMatchObject({ status: 'found' });
    expect(await lookupDictionary('unknown-word')).toEqual({ status: 'not_found' });
  });

  it('内置词库为空时报告未配置', async () => {
    mockLocalDictionary({});
    listDictionariesMock.mockResolvedValue({ items: [] });
    lookupServerDictionaryMock.mockResolvedValue({ result: { status: 'not_found' } });
    const { lookupDictionary } = await loadDictionaryModule();

    expect(await lookupDictionary('fuse')).toEqual({ status: 'unconfigured' });
  });

  it('内置文件加载失败时报告错误', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 500 })) as unknown as typeof fetch;
    listDictionariesMock.mockResolvedValue({ items: [] });
    lookupServerDictionaryMock.mockRejectedValue(new Error('network'));
    const { lookupDictionary } = await loadDictionaryModule();

    expect(await lookupDictionary('fuse')).toEqual({ status: 'error' });
  });

  it('面板同步的计数可避免重复请求列表', async () => {
    mockLocalDictionary({});
    listDictionariesMock.mockResolvedValue({ items: [dictionarySummary()] });
    lookupServerDictionaryMock.mockResolvedValue({
      result: { status: 'found', dictionaryId: 'ecdict-full', entry: { meanings: ['x'] } },
    });
    const { lookupDictionary } = await loadDictionaryModule();
    const { setInstalledDictionaryCount } = await import('@/lib/dictionaries/installedDictionaryCache');

    setInstalledDictionaryCount(1);
    await lookupDictionary('fuse');

    expect(listDictionariesMock).not.toHaveBeenCalled();
    expect(lookupServerDictionaryMock).toHaveBeenCalledTimes(1);
  });
});

describe('countReadyInstalledDictionaries', () => {
  it('只统计已就绪且启用的非内置词典', async () => {
    const { countReadyInstalledDictionaries } = await import('@/lib/dictionaries/installedDictionaryCache');
    const count = countReadyInstalledDictionaries([
      { builtin: true, status: 'ready', enabled: true },
      { builtin: false, status: 'ready', enabled: true },
      { builtin: false, status: 'ready', enabled: false },
      { builtin: false, status: 'installing', enabled: true },
      { builtin: false, status: 'error', enabled: true },
    ]);
    expect(count).toBe(1);
  });
});

describe('所有格和完整词组查询', () => {
  it.each(['military’s', "military's", 'military‘S'])('所有格 %s 能查到 military', async (term) => {
    mockLocalDictionary({ military: { meanings: ['军事的'] } });
    const { lookupDictionary } = await loadDictionaryModule();
    expect(await lookupDictionary(term)).toMatchObject({ status: 'found', entry: { meanings: ['军事的'] } });
  });

  it('所有格的精确词条仍优先于去掉后缀的回退', async () => {
    mockLocalDictionary({ "john's": { meanings: ['完整词条'] }, john: { meanings: ['名字'] } });
    const { lookupDictionary } = await loadDictionaryModule();
    expect(await lookupDictionary("john's")).toMatchObject({ entry: { meanings: ['完整词条'] } });
  });

  it('常见缩写不能被错误剥掉 s', async () => {
    mockLocalDictionary({ it: { meanings: ['它'] }, "it's": { meanings: ['it is 的缩写'] } });
    const { lookupDictionary } = await loadDictionaryModule();
    expect(await lookupDictionary('it’s')).toMatchObject({ entry: { meanings: ['it is 的缩写'] } });
  });

  it('本地只有 give 不能当作 give up 已收录', async () => {
    mockLocalDictionary({ give: { meanings: ['给'] } });
    lookupServerDictionaryMock.mockResolvedValue({ result: { status: 'not_found' } });
    const { lookupDictionary } = await loadDictionaryModule();
    expect(await lookupDictionary('give up')).toEqual({ status: 'not_found' });
  });

  it('连字符转换必须保留整个复合词，不能命中前半个词', async () => {
    mockLocalDictionary({ take: { meanings: ['拿'] }, 'take off': { meanings: ['起飞'] } });
    const { lookupDictionary } = await loadDictionaryModule();
    expect(await lookupDictionary('take-off')).toMatchObject({ entry: { meanings: ['起飞'] } });
  });
});
