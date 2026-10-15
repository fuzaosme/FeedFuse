import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { clearDictionaryLookupCache } from './dictionariesService';
import { ConflictError, NotFoundError, ValidationError } from '@/server/infra/http/errors';
import { isSafeExternalUrl } from '@/server/integrations/rss/ssrfGuard';
import { fetchBytesWithValidatedRedirects } from '@/server/infra/http/fetchExternalBytes';
import {
  clearDictionaryEntries,
  countDictionaryEntries,
  dictionaryInsertBatchSize,
  getDictionaryRecord,
  insertDictionaryEntries,
  patchDictionary,
  upsertDictionary,
  type DictionaryRecord,
} from './dictionariesRepo';
import {
  buildCustomDictionaryId,
  findManifestEntry,
  type DictionaryManifestEntry,
} from './manifest';
import { iterateAppJsonEntries, iterateEcdictEntries, type DictionaryEntryInput } from './parsers';
import { registerInstall, runningInstallCount, unregisterInstall } from './installRegistry';

/** 下载体积上限：完整版 ECDICT 约 63 MB，这里留出充足余量。 */
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
/** 空闲超时：超过这个时间没有收到任何数据就中断。 */
const DOWNLOAD_IDLE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;
/** 进度写库节流，避免每一批都更新同一行。 */
const PROGRESS_WRITE_INTERVAL_MS = 1_000;
const CUSTOM_DICTIONARY_PRIORITY = 200;
const MANIFEST_DICTIONARY_PRIORITY = 100;

type SupportedFormat = DictionaryManifestEntry['format'] | 'app-json';
type ResolvedFormat = SupportedFormat | 'auto';

interface ResolvedSource {
  record: DictionaryRecord;
  source: { url: string; sha256?: string; bytes?: number };
  format: ResolvedFormat;
}

/** 自定义链接在拿到内容后再判断格式，避免依赖文件扩展名。 */
function detectCustomFormat(text: string): SupportedFormat {
  return text.trimStart().startsWith('{') ? 'app-json' : 'ecdict-csv';
}

function customDictionaryName(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    const last = url.pathname.split('/').filter(Boolean).pop();
    return last ? `自定义词典 · ${decodeURIComponent(last)}` : `自定义词典 · ${url.hostname}`;
  } catch {
    return '自定义词典';
  }
}

async function resolveManifestSource(pool: Pool, id: string): Promise<ResolvedSource> {
  const entry = findManifestEntry(id);
  if (!entry) throw new NotFoundError('未找到该词典');
  const source = entry.sources[0];
  if (!source) throw new ValidationError('该词典没有可用的下载地址', { id: '缺少下载地址' });
  if (await getDictionaryRecord(pool, id)) {
    // 覆盖安装前先清掉旧数据，避免不同来源的条目混在一起。
    await clearDictionaryEntries(pool, id);
  }
  const record = await upsertDictionary(pool, {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    language: entry.language,
    license: entry.license,
    attribution: entry.attribution,
    homepage: entry.homepage,
    sourceUrl: source.url,
    priority: MANIFEST_DICTIONARY_PRIORITY,
    totalEntries: entry.totalEntries,
    totalBytes: entry.totalBytes,
  });
  return { record, source, format: entry.format };
}

async function resolveCustomSource(pool: Pool, sourceUrl: string): Promise<ResolvedSource> {
  const id = buildCustomDictionaryId(sourceUrl);
  if (await getDictionaryRecord(pool, id)) {
    await clearDictionaryEntries(pool, id);
  }
  const record = await upsertDictionary(pool, {
    id,
    name: customDictionaryName(sourceUrl),
    description: '由自定义链接导入的词典，授权与内容准确性由导入者自行确认。',
    language: 'en-zh',
    license: '自定义来源',
    attribution: `来源：${sourceUrl}`,
    homepage: sourceUrl,
    sourceUrl,
    priority: CUSTOM_DICTIONARY_PRIORITY,
    totalEntries: 0,
    totalBytes: 0,
  });
  return { record, source: { url: sourceUrl }, format: 'auto' };
}

/** 同一时间只允许一个安装任务，避免同时把几十 MB 文本读进内存。 */
function assertNoRunningInstall(): void {
  if (runningInstallCount() > 0) {
    throw new ConflictError('已有词典正在下载，请等它完成后再试');
  }
}

export async function startManifestInstall(pool: Pool, id: string): Promise<DictionaryRecord> {
  assertNoRunningInstall();
  const resolved = await resolveManifestSource(pool, id);
  void runInstall(pool, resolved);
  return resolved.record;
}

export async function startCustomInstall(
  pool: Pool,
  sourceUrl: string,
): Promise<DictionaryRecord> {
  assertNoRunningInstall();
  const resolved = await resolveCustomSource(pool, sourceUrl);
  void runInstall(pool, resolved);
  return resolved.record;
}

async function downloadSource(
  pool: Pool,
  record: DictionaryRecord,
  source: ResolvedSource['source'],
  signal: AbortSignal,
): Promise<string> {
  let lastWrite = 0;
  let buffer: Buffer;
  try {
    const result = await fetchBytesWithValidatedRedirects(source.url, {
      idleTimeoutMs: DOWNLOAD_IDLE_TIMEOUT_MS,
      headers: { accept: 'text/csv,application/json,text/plain,*/*' },
      maxBytes: MAX_DOWNLOAD_BYTES,
      maxRedirects: MAX_REDIRECTS,
      isSafeUrl: isSafeExternalUrl,
      onProgress: (received, total) => {
        const now = Date.now();
        if (now - lastWrite < PROGRESS_WRITE_INTERVAL_MS) return;
        lastWrite = now;
        void patchDictionary(pool, record.id, {
          downloadedBytes: received,
          totalBytes: total ?? source.bytes ?? record.totalBytes,
        }).catch(() => undefined);
      },
    });
    if (result.status !== 200) {
      throw new Error(`HTTP ${result.status}`);
    }
    buffer = result.body;
  } catch (error) {
    if (signal.aborted) throw error;
    const reason = error instanceof Error ? error.message : '未知错误';
    throw new Error(
      reason === 'Response too large'
        ? '词典文件超过大小上限'
        : `词典下载失败：${reason}`,
    );
  }

  if (source.sha256) {
    const actual = createHash('sha256').update(buffer).digest('hex');
    if (actual !== source.sha256) {
      throw new Error('词典文件校验失败，可能上游内容已变更');
    }
  }
  await patchDictionary(pool, record.id, {
    downloadedBytes: buffer.byteLength,
    totalBytes: source.bytes ?? buffer.byteLength,
  });
  return buffer.toString('utf8');
}

async function importEntries(
  pool: Pool,
  record: DictionaryRecord,
  text: string,
  format: ResolvedFormat,
  signal: AbortSignal,
): Promise<number> {
  const resolvedFormat = format === 'auto' ? detectCustomFormat(text) : format;
  const generator =
    resolvedFormat === 'app-json' ? iterateAppJsonEntries(text) : iterateEcdictEntries(text);

  let batch: DictionaryEntryInput[] = [];
  let imported = 0;
  let lastWrite = Date.now();

  const flush = async () => {
    if (!batch.length) return;
    const current = batch;
    batch = [];
    imported += await insertDictionaryEntries(pool, record.id, current);
    if (Date.now() - lastWrite >= PROGRESS_WRITE_INTERVAL_MS) {
      lastWrite = Date.now();
      await patchDictionary(pool, record.id, { entryCount: imported });
    }
  };

  for (const entry of generator) {
    if (signal.aborted) return imported;
    batch.push(entry);
    if (batch.length >= dictionaryInsertBatchSize) await flush();
  }
  await flush();
  return imported;
}

async function runInstall(pool: Pool, resolved: ResolvedSource): Promise<void> {
  const controller = new AbortController();
  const { record } = resolved;
  registerInstall(record.id, controller);

  try {
    const text = await downloadSource(pool, record, resolved.source, controller.signal);
    if (controller.signal.aborted) return;
    const imported = await importEntries(
      pool, record, text, resolved.format, controller.signal,
    );
    if (controller.signal.aborted) return;
    // 以数据库实际行数为准，避免进度计数与真实词条数不一致。
    const stored = await countDictionaryEntries(pool, record.id);
    await patchDictionary(pool, record.id, {
      status: 'ready',
      error: '',
      entryCount: stored || imported,
      totalEntries: stored || imported,
      markInstalled: true,
    });
    clearDictionaryLookupCache();
  } catch (error) {
    // 词典可能已被删除（删除会 abort 正在进行的任务），此时不要再写回状态。
    const stillExists = await getDictionaryRecord(pool, record.id).catch(() => null);
    if (!stillExists) return;
    await clearDictionaryEntries(pool, record.id).catch(() => undefined);
    await patchDictionary(pool, record.id, {
      status: 'error',
      error: controller.signal.aborted
        ? '安装已取消'
        : error instanceof Error
          ? error.message
          : '词典安装失败',
      entryCount: 0,
    }).catch(() => undefined);
  } finally {
    unregisterInstall(record.id);
  }
}
