import type { FeverBatchReadTask, MarkAllReadResult } from '@/types/feverBatchRead';
import type { DictionaryLookupResult, DictionarySummary } from '@/types/dictionaries';
import ky from 'ky';
import type {
  Article,
  Category,
  Feed,
  PersistedSettings,
  SystemLogsPage,
  UserType,
  VocabularyEntry,
} from '@/types';
import { ENGLISH_LEARNING_TIMEOUT_MS } from '@/lib/englishLearning';
import { notifyApiError } from './apiErrorNotifier';
import { normalizeFeedAutoTriggerFlags } from '@/lib/feeds/feedAutoTriggerPolicy';
import { AI_DIGEST_ICON_URL } from '@/lib/feeds/feedIcons';
import { isRecord } from '@/lib/utils';

export interface ApiErrorPayload {
  code: string;
  message: string;
  fields?: Record<string, string>;
}

export class ApiError extends Error {
  status?: number;
  cause?: unknown;

  constructor(
    message: string,
    public code: string,
    public fields?: Record<string, string>,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message);
    this.status = options?.status;
    this.cause = options?.cause;
  }
}

/** 仅在服务端明确不支持流式协议、且尚未显示正文时兼容旧接口。 */
export function canFallbackEnglishStream(error: unknown, receivedText: boolean): boolean {
  return !receivedText && error instanceof ApiError && error.code === 'stream_unsupported';
}

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: ApiErrorPayload };
type ApiEnvelope<T> = ApiOk<T> | ApiFail;

export interface RequestApiOptions {
  notifyOnError?: boolean;
  notifyMessage?: string;
  redirectOnUnauthorized?: boolean;
}

const api = ky.create({
  timeout: 15_000,
  retry: 0,
  throwHttpErrors: false,
});

function getBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

function toAbsoluteUrl(path: string): string {
  return new URL(path, getBaseUrl()).toString();
}

function throwTransportApiError(
  err: unknown,
  options?: RequestApiOptions & { timeoutMs?: number },
): never {
  const isTimeout =
    err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
  const message = isTimeout ? '请求超时，请稍后重试' : '网络异常，请检查网络后重试';
  const code = isTimeout ? 'timeout' : 'network_error';

  if (options?.notifyOnError !== false) {
    notifyApiError(options?.notifyMessage ?? message);
  }

  throw new ApiError(options?.notifyMessage ?? message, code, undefined, { cause: err });
}

function throwInvalidResponseApiError(
  status?: number,
  options?: RequestApiOptions & { timeoutMs?: number },
): never {
  if (options?.notifyOnError !== false) {
    notifyApiError(options?.notifyMessage ?? '暂时无法完成请求，请稍后重试');
  }

  throw new ApiError('服务返回了无效数据，请稍后重试', 'invalid_response', undefined, {
    status,
  });
}

function redirectToLoginIfNeeded(options?: RequestApiOptions) {
  if (
    options?.redirectOnUnauthorized === false ||
    typeof window === 'undefined' ||
    window.location.pathname === '/login'
  ) {
    return;
  }

  window.location.assign('/login');
}

function parseContentDispositionFileName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = value.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = value.match(/filename=([^;]+)/i);
  return plainMatch?.[1]?.trim() ?? null;
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.code === 'string' && typeof value.message === 'string';
}

async function requestApi<T>(
  path: string,
  init?: RequestInit,
  options?: RequestApiOptions & { timeoutMs?: number },
): Promise<T> {
  let res: Response;

  try {
    res = await api(toAbsoluteUrl(path), {
      ...(init ?? {}),
      timeout: options?.timeoutMs ?? 15_000,
      headers: {
        ...(init?.headers ?? {}),
        accept: 'application/json',
      },
    });
  } catch (err) {
    throwTransportApiError(err, options);
  }

  const json: unknown = await res.json().catch(() => null);
  if (!isRecord(json) || typeof json.ok !== 'boolean') {
    throwInvalidResponseApiError(res.status, options);
  }

  const envelope = json as ApiEnvelope<T>;
  if (envelope.ok) return envelope.data;

  const payload = envelope.error;
  if (res.status === 401 || payload?.code === 'unauthorized') {
    redirectToLoginIfNeeded(options);
  }
  const message = options?.notifyMessage ?? payload?.message ?? '暂时无法完成请求，请稍后重试';
  if (options?.notifyOnError !== false) {
    notifyApiError(message);
  }

  throw new ApiError(
    payload?.message ?? '暂时无法完成请求，请稍后重试',
    payload?.code ?? 'unknown_error',
    payload?.fields,
    { status: res.status },
  );
}

export interface OpmlImportResult {
  importedCount: number;
  duplicateCount: number;
  invalidCount: number;
  createdCategoryCount: number;
  duplicates: Array<{ title: string; xmlUrl: string; reason: 'duplicate_in_file' | 'duplicate_in_db' }>;
  invalidItems: Array<{ title: string | null; xmlUrl: string | null; reason: 'missing_xml_url' | 'invalid_url' }>;
}

export type CurrentUserRole = 'admin' | 'member';
export type CurrentUserStatus = 'active' | 'disabled';

export interface CurrentUser {
  id: string;
  username?: string;
  type?: UserType;
  role: CurrentUserRole;
  status?: CurrentUserStatus;
  sessionVersion?: number;
  createdAt?: string;
  updatedAt?: string;
}

export async function login(
  input: { username: string; password: string },
  options?: RequestApiOptions,
): Promise<{ authenticated: boolean; user?: CurrentUser }> {
  return requestApi(
    '/api/auth/login',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function getCurrentUser(options?: RequestApiOptions): Promise<CurrentUser> {
  return requestApi('/api/auth/me', undefined, {
    ...(options ?? {}),
    redirectOnUnauthorized: false,
  });
}

export async function logout(options?: RequestApiOptions): Promise<{ authenticated: boolean }> {
  return requestApi(
    '/api/auth/logout',
    {
      method: 'POST',
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function changePassword(
  input: { currentPassword: string; nextPassword: string },
  options?: RequestApiOptions,
): Promise<{ updated: boolean }> {
  return requestApi(
    '/api/settings/auth/password',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function changeOwnPassword(
  input: { currentPassword: string; nextPassword: string },
  options?: RequestApiOptions,
): Promise<{ updated: boolean }> {
  return requestApi(
    '/api/users/me/password',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function updateCurrentUserProfile(
  input: {
    username: string;
    currentPassword?: string;
    nextPassword?: string;
  },
  options?: RequestApiOptions,
): Promise<CurrentUser> {
  return requestApi(
    '/api/users/me',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    {
      ...(options ?? {}),
      redirectOnUnauthorized: false,
    },
  );
}

export async function listUsers(options?: RequestApiOptions): Promise<CurrentUser[]> {
  return requestApi('/api/users', undefined, options);
}

export async function createUser(
  input: { username: string; password: string; role: CurrentUserRole },
  options?: RequestApiOptions,
): Promise<CurrentUser> {
  return requestApi(
    '/api/users',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function updateUser(
  userId: string,
  input: {
    username?: string;
    role?: CurrentUserRole;
    status?: CurrentUserStatus;
    password?: string;
  },
  options?: RequestApiOptions,
): Promise<CurrentUser> {
  return requestApi(
    `/api/users/${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteUser(
  userId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: boolean }> {
  return requestApi(
    `/api/users/${encodeURIComponent(userId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function importOpml(input: {
  content: string;
  fileName?: string | null;
}, options?: RequestApiOptions): Promise<OpmlImportResult> {
  return requestApi(
    '/api/opml/import',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function exportOpml(
  options?: RequestApiOptions & { timeoutMs?: number },
): Promise<{ xml: string; fileName: string }> {
  let res: Response;

  try {
    res = await api(toAbsoluteUrl('/api/opml/export'), {
      method: 'GET',
      headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.8' },
      timeout: options?.timeoutMs ?? 15_000,
    });
  } catch (err) {
    throwTransportApiError(err, options);
  }

  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    if (!isRecord(json) || json.ok !== false || !isApiErrorPayload(json.error)) {
      throwInvalidResponseApiError(res.status, options);
    }

    const payload = json.error;
    const message = payload.message ?? '暂时无法完成请求，请稍后重试';
    if (options?.notifyOnError !== false) {
      notifyApiError(message);
    }
    throw new ApiError(
      payload.message ?? '暂时无法完成请求，请稍后重试',
      payload.code ?? 'unknown_error',
      payload.fields,
      { status: res.status },
    );
  }

  return {
    xml: await res.text(),
    fileName:
      parseContentDispositionFileName(res.headers.get('content-disposition')) ??
      'feedfuse-subscriptions.opml',
  };
}

export type RssValidationErrorCode =
  | 'invalid_url'
  | 'unsafe_url'
  | 'unauthorized'
  | 'access_blocked'
  | 'timeout'
  | 'not_feed'
  | 'dns_error'
  | 'network_error';

export interface RssValidationResult {
  ok: boolean;
  kind?: 'rss' | 'atom';
  title?: string;
  siteUrl?: string;
  errorCode?: RssValidationErrorCode;
  message?: string;
}

type RssValidationEnvelope =
  | {
      ok: true;
      data: {
        valid: boolean;
        reason?: RssValidationErrorCode;
        message?: string;
        kind?: 'rss' | 'atom';
        title?: string;
        siteUrl?: string;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

export async function validateRssUrl(url: string): Promise<RssValidationResult> {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      errorCode: 'invalid_url',
      message: '请输入完整链接，例如 https://example.com/feed.xml',
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, errorCode: 'invalid_url', message: '链接必须以 http:// 或 https:// 开头' };
  }

  try {
    const endpoint = new URL('/api/rss/validate', getBaseUrl());
    endpoint.searchParams.set('url', url);

    const res = await api(endpoint.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
      timeout: 12_000,
    });

    const json: unknown = await res.json().catch(() => null);
    if (typeof json !== 'object' || json === null || !('ok' in json)) {
      return { ok: false, errorCode: 'network_error', message: '暂时无法验证链接，请稍后重试' };
    }

    const envelope = json as RssValidationEnvelope;

    if (!envelope.ok) {
      return {
        ok: false,
        errorCode: 'network_error',
        message: envelope.error.message,
      };
    }

    if (envelope.data.valid) {
      return {
        ok: true,
        kind: envelope.data.kind,
        title: envelope.data.title,
        siteUrl: envelope.data.siteUrl,
      };
    }

    return {
      ok: false,
      errorCode: envelope.data.reason,
      message: envelope.data.message,
    };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    if (isTimeout) {
      return { ok: false, errorCode: 'timeout', message: '验证超时，请稍后重试' };
    }
    return { ok: false, errorCode: 'network_error', message: '暂时无法验证链接，请稍后重试' };
  }
}

export interface ReaderSnapshotDto {
  categories: Array<{
    id: string;
    name: string;
    position: number;
  }>;
  feeds: Array<{
    id: string;
    kind: Feed['kind'];
    provider?: Feed['provider'];
    remoteManaged?: boolean;
    remoteSource?: 'fever' | null;
    title: string;
    url: string;
    siteUrl: string | null;
    iconUrl: string | null;
    enabled: boolean;
    fullTextOnOpenEnabled: boolean;
    fullTextOnFetchEnabled: boolean;
    aiSummaryOnOpenEnabled: boolean;
    aiSummaryOnFetchEnabled: boolean;
    bodyTranslateOnFetchEnabled: boolean;
    bodyTranslateOnOpenEnabled: boolean;
    titleTranslateEnabled: boolean;
    bodyTranslateEnabled: boolean;
    articleListDisplayMode: 'card' | 'list';
    categoryId: string | null;
    fetchIntervalMinutes: number;
    lastFetchStatus: number | null;
    lastFetchError: string | null;
    lastFetchRawError: string | null;
    unreadCount: number;
    isPodcast?: boolean;
  }>;
  articles: {
    items: Array<{
      id: string;
      feedId: string;
      title: string;
      titleOriginal?: string | null;
      titleZh?: string | null;
      summary: string | null;
      previewImage?: string | null;
      author: string | null;
      publishedAt: string | null;
      link: string | null;
      filterStatus: 'pending' | 'passed' | 'filtered' | 'error';
      isFiltered: boolean;
      filteredBy: string[];
      isRead: boolean;
      isStarred: boolean;
      remoteSource?: 'fever' | null;
      bodyTranslationEligible?: boolean;
      bodyTranslationBlockedReason?: string | null;
      aiSummarySession?: ArticleAiSummarySessionSnapshotDto | null;
    }>;
    nextCursor: string | null;
    totalCount: number;
  };
}

export async function getReaderSnapshot(
  input?: {
    view?: string;
    limit?: number;
    cursor?: string;
    unreadOnly?: boolean;
    includeFiltered?: boolean;
  },
  options?: RequestApiOptions,
): Promise<ReaderSnapshotDto> {
  const params = new URLSearchParams();
  if (input?.view) params.set('view', input.view);
  if (typeof input?.limit === 'number') params.set('limit', String(input.limit));
  if (input?.cursor) params.set('cursor', input.cursor);
  if (typeof input?.unreadOnly === 'boolean') {
    params.set('unreadOnly', String(input.unreadOnly));
  }
  if (typeof input?.includeFiltered === 'boolean') {
    params.set('includeFiltered', String(input.includeFiltered));
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestApi<ReaderSnapshotDto>(`/api/reader/snapshot${suffix}`, undefined, options);
}

export async function createFeed(input: {
  title: string;
  url: string;
  siteUrl?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  fullTextOnOpenEnabled?: boolean;
  fullTextOnFetchEnabled?: boolean;
  aiSummaryOnOpenEnabled?: boolean;
  aiSummaryOnFetchEnabled?: boolean;
  bodyTranslateOnFetchEnabled?: boolean;
  bodyTranslateOnOpenEnabled?: boolean;
  titleTranslateEnabled?: boolean;
  bodyTranslateEnabled?: boolean;
}, options?: RequestApiOptions): Promise<
  ReaderSnapshotDto['feeds'][number] & {
    unreadCount: number;
  }
> {
  const payload = Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value !== 'undefined'),
  );

  return requestApi(
    '/api/feeds',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export async function createAiDigest(input: {
  title: string;
  prompt: string;
  intervalMinutes: number;
  selectedFeedIds: string[];
  categoryId?: string | null;
  categoryName?: string | null;
}, options?: RequestApiOptions): Promise<
  ReaderSnapshotDto['feeds'][number] & {
    unreadCount: number;
  }
> {
  return requestApi(
    '/api/ai-digests',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export interface AiDigestConfigDto {
  feedId: string;
  prompt: string;
  intervalMinutes: number;
  selectedFeedIds: string[];
}

export async function getAiDigestConfig(feedId: string): Promise<AiDigestConfigDto> {
  return requestApi(`/api/ai-digests/${encodeURIComponent(feedId)}`);
}

export async function patchAiDigest(
  feedId: string,
  input: {
    title: string;
    prompt: string;
    intervalMinutes: number;
    selectedFeedIds: string[];
    categoryId?: string | null;
    categoryName?: string | null;
  },
  options?: RequestApiOptions,
): Promise<FeedRowDto> {
  const payload = Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value !== 'undefined'),
  );

  return requestApi(
    `/api/ai-digests/${encodeURIComponent(feedId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export async function generateAiDigest(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ enqueued: boolean; jobId?: string; reason?: string; runId?: string }> {
  return requestApi(
    `/api/ai-digests/${encodeURIComponent(feedId)}/generate`,
    {
      method: 'POST',
    },
    options,
  );
}

export async function getAiDigestRunStatus(runId: string): Promise<{
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped_no_updates';
  errorCode: string | null;
  errorMessage: string | null;
  updatedAt: string;
}> {
  return requestApi(`/api/ai-digests/runs/${encodeURIComponent(runId)}`);
}

export async function getFeedRefreshRunStatus(runId: string): Promise<{
  id: string;
  scope: 'single' | 'all';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  feedId: string | null;
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  errorMessage: string | null;
  updatedAt: string;
  finishedAt: string | null;
}> {
  return requestApi(`/api/feed-refresh-runs/${encodeURIComponent(runId)}`);
}

export async function refreshFeed(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ enqueued: true; jobId: string; runId?: string }> {
  return requestApi(
    `/api/feeds/${encodeURIComponent(feedId)}/refresh`,
    {
      method: 'POST',
    },
    options,
  );
}

export async function refreshAllFeeds(
  options?: RequestApiOptions,
): Promise<{ enqueued: true; jobId: string; runId?: string }> {
  return requestApi(
    '/api/feeds/refresh',
    {
      method: 'POST',
    },
    options,
  );
}

export interface FeedRowDto {
  id: string;
  kind: Feed['kind'];
  provider?: Feed['provider'];
  remoteManaged?: boolean;
  remoteSource?: 'fever' | null;
  title: string;
  url: string;
  siteUrl: string | null;
  iconUrl: string | null;
  enabled: boolean;
  fullTextOnOpenEnabled: boolean;
  fullTextOnFetchEnabled: boolean;
  aiSummaryOnOpenEnabled: boolean;
  aiSummaryOnFetchEnabled: boolean;
  bodyTranslateOnFetchEnabled: boolean;
  bodyTranslateOnOpenEnabled: boolean;
  titleTranslateEnabled: boolean;
  bodyTranslateEnabled: boolean;
  articleListDisplayMode: 'card' | 'list';
  categoryId: string | null;
  fetchIntervalMinutes: number;
  isPodcast?: boolean;
}

type FeedDtoLike =
  | ReaderSnapshotDto['feeds'][number]
  | (FeedRowDto & {
      unreadCount?: number;
      lastFetchStatus?: number | null;
      lastFetchError?: string | null;
      lastFetchRawError?: string | null;
    });

export async function patchFeed(
  feedId: string,
  input: {
    title?: string;
    url?: string;
    siteUrl?: string | null;
    enabled?: boolean;
    categoryId?: string | null;
    categoryName?: string | null;
    fullTextOnOpenEnabled?: boolean;
    fullTextOnFetchEnabled?: boolean;
    aiSummaryOnOpenEnabled?: boolean;
    aiSummaryOnFetchEnabled?: boolean;
    bodyTranslateOnFetchEnabled?: boolean;
    bodyTranslateOnOpenEnabled?: boolean;
    titleTranslateEnabled?: boolean;
    articleListDisplayMode?: 'card' | 'list';
  },
  options?: RequestApiOptions,
): Promise<FeedRowDto> {
  const payload = Object.fromEntries(
    Object.entries(input).filter(
      ([key, value]) => key !== 'bodyTranslateEnabled' && typeof value !== 'undefined',
    ),
  );

  return requestApi(
    `/api/feeds/${encodeURIComponent(feedId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    options,
  );
}

export async function deleteFeed(
  feedId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: true }> {
  return requestApi(
    `/api/feeds/${encodeURIComponent(feedId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export interface CategoryDto {
  id: string;
  name: string;
  position: number;
}

export async function listCategories(): Promise<CategoryDto[]> {
  return requestApi('/api/categories');
}

export async function createCategory(
  input: { name: string },
  options?: RequestApiOptions,
): Promise<CategoryDto> {
  return requestApi(
    '/api/categories',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function patchCategory(
  categoryId: string,
  input: { name?: string; position?: number },
  options?: RequestApiOptions,
): Promise<CategoryDto> {
  return requestApi(
    `/api/categories/${encodeURIComponent(categoryId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteCategory(
  categoryId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: true }> {
  return requestApi(
    `/api/categories/${encodeURIComponent(categoryId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function reorderCategories(
  items: Array<{ id: string; position: number }>,
  options?: RequestApiOptions,
): Promise<CategoryDto[]> {
  return requestApi(
    '/api/categories/reorder',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    },
    options,
  );
}

export async function patchArticle(
  articleId: string,
  input: { isRead?: boolean; isStarred?: boolean },
  options?: RequestApiOptions,
): Promise<{ updated: true }> {
  return requestApi(
    `/api/articles/${encodeURIComponent(articleId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function listVocabulary(
  options?: RequestApiOptions,
  signal?: AbortSignal,
): Promise<{ items: VocabularyEntry[] }> {
  return requestApi('/api/vocabulary', { cache: 'no-store', signal }, options);
}

export async function addVocabulary(input: {
  articleId: string;
  term: string;
  definition: string;
  sourceSentence: string;
}, options?: RequestApiOptions, signal?: AbortSignal): Promise<{ entry: VocabularyEntry }> {
  return requestApi('/api/vocabulary', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  }, options);
}

export async function patchVocabulary(
  id: string, definition: string, options?: RequestApiOptions, signal?: AbortSignal,
): Promise<{ entry: VocabularyEntry }> {
  return requestApi(`/api/vocabulary/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ definition }),
    signal,
  }, options);
}

export async function deleteVocabulary(
  id: string, options?: RequestApiOptions, signal?: AbortSignal,
): Promise<{ deleted: true }> {
  return requestApi(`/api/vocabulary/${encodeURIComponent(id)}`, { method: 'DELETE', signal }, options);
}

export async function listDictionaries(
  options?: RequestApiOptions,
  signal?: AbortSignal,
): Promise<{ items: DictionarySummary[] }> {
  return requestApi('/api/dictionaries', { cache: 'no-store', signal }, options);
}

export async function installDictionary(
  id: string,
  options?: RequestApiOptions,
): Promise<{ item: DictionarySummary }> {
  return requestApi('/api/dictionaries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id }),
  }, options);
}

export async function installCustomDictionary(
  sourceUrl: string,
  options?: RequestApiOptions,
): Promise<{ item: DictionarySummary }> {
  return requestApi('/api/dictionaries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sourceUrl }),
  }, options);
}

export async function setDictionaryEnabled(
  id: string,
  enabled: boolean,
  options?: RequestApiOptions,
): Promise<{ item: DictionarySummary }> {
  return requestApi(`/api/dictionaries/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  }, options);
}

export async function deleteDictionary(
  id: string,
  options?: RequestApiOptions,
): Promise<{ deleted: true }> {
  return requestApi(`/api/dictionaries/${encodeURIComponent(id)}`, { method: 'DELETE' }, options);
}

export async function lookupServerDictionary(
  term: string,
  options?: RequestApiOptions,
  signal?: AbortSignal,
): Promise<{ result: DictionaryLookupResult }> {
  return requestApi(
    `/api/dictionaries/lookup?term=${encodeURIComponent(term)}`,
    { cache: 'no-store', signal },
    options,
  );
}

/**
 * 精读链路 SSE 增量回调：服务端每推送一个 `learning.delta` 就把当前累积文本回传一次，
 * 调用方（useEnglishLearning）据此边收边渲染，实现体感首字即时显示。
 */
export type EnglishStreamDeltaHandler = (partial: string) => void;

interface EnglishStreamRequestOptions {
  timeoutMs?: number;
  onDelta?: EnglishStreamDeltaHandler;
}

function linkStreamSignal(signal: AbortSignal, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
  /** 超时后为 true；调用方可据此区分“用户主动取消”和“服务端思考太久超时”。 */
  timedOut: () => boolean;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    controller.abort(signal.reason);
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort(new DOMException('English learning stream timed out', 'TimeoutError'));
  }, timeoutMs);
  // 超时计时器不能拖住进程退出。
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as { unref: () => void }).unref();
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
    timedOut: () => didTimeout,
  };
}

/**
 * 解析精读 SSE 流：`learning.delta` 累积并回调、`learning.done` 定稿、
 * `learning.error` 转为 ApiError。返回完整讲解文本。
 */
async function readEnglishStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onDelta: EnglishStreamDeltaHandler | undefined,
  signal: AbortSignal,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let completed = false;

  const handleEvent = (event: string, rawData: string): void => {
    if (!rawData) return;
    let payload: unknown = null;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return;
    }
    if (!isRecord(payload)) return;
    if (event === 'learning.delta' && typeof payload.delta === 'string' && payload.delta) {
      full += payload.delta;
      onDelta?.(full);
    } else if (event === 'learning.done' && typeof payload.explanation === 'string') {
      completed = true;
      // 服务端经过 thinking 过滤的定稿为准；为空时沿用累积文本。
      if (payload.explanation) full = payload.explanation;
      else onDelta?.(full);
    } else if (event === 'learning.error') {
      const code = typeof payload.code === 'string' ? payload.code : 'ai_request_failed';
      const message = typeof payload.message === 'string' ? payload.message : '暂时无法生成讲解，请重试';
      throw new ApiError(message, code);
    }
  };

  for (;;) {
    if (signal.aborted) {
      // 超时和用户取消都走这里中断读流；具体是哪一种由调用方按原始 signal 判定，
      // 这里统一按“可重试的超时”抛，调用方在用户主动取消时不再回退重试。
      throw new ApiError('讲解请求超时，请重试', 'timeout', undefined, { cause: signal.reason });
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let event = '';
      let data = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
        // 以 ':' 开头的 keep-alive 注释直接忽略。
      }
      handleEvent(event, data);
      boundary = buffer.indexOf('\n\n');
    }
  }
  if (!completed) throw new ApiError('讲解连接中断，已保留收到的内容，请重试', 'incomplete_stream');
  return full;
}

/**
 * 精读 POST 的流式版本：走 `?stream=1` SSE 边收边渲染。
 * 任何失败都直接抛给调用方，由调用方决定是否回退到 Buffered JSON；
 * Abort/超时通过关联 signal 保证，调用方透传原始 signal 即可中断。
 */
async function postEnglishLearningStream(
  path: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  options?: EnglishStreamRequestOptions,
  fallbackMessage = '暂时无法生成讲解，请重试',
): Promise<{ explanation: string }> {
  const timeoutMs = options?.timeoutMs ?? ENGLISH_LEARNING_TIMEOUT_MS;
  const linked = linkStreamSignal(signal, timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(toAbsoluteUrl(`${path}?stream=1`), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify(body),
        signal: linked.signal,
        credentials: 'same-origin',
      });
    } catch (err) {
      // 用户主动取消：直接透出，不触发回退重试（调用方检测到原始 signal 已 abort 会静默返回）。
      if (signal.aborted) {
        throw new ApiError('已取消讲解请求', 'aborted', undefined, { cause: err });
      }
      // 流超时：linked 超时 abort，但原始 signal 未 abort，调用方可回退到 Buffered 重试一次。
      if (linked.timedOut() || linked.signal.aborted) {
        throw new ApiError('讲解请求超时，请重试', 'timeout', undefined, { cause: err });
      }
      throw new ApiError('网络异常，请检查网络后重试', 'network_error', undefined, { cause: err });
    }
    const contentType = res.headers.get('content-type') ?? '';
    if ([406, 415, 501].includes(res.status)) {
      await res.body?.cancel();
      throw new ApiError('当前服务不支持流式讲解', 'stream_unsupported', undefined, { status: res.status });
    }
    if (!contentType.includes('text/event-stream') || !res.body) {
      // 服务端未返回 SSE（例如错误包）：按 Buffered 信封解析，保持原错误语义。
      const json: unknown = await res.json().catch(() => null);
      if (isRecord(json) && typeof json.ok === 'boolean') {
        const envelope = json as ApiEnvelope<{ explanation: string }>;
        if (envelope.ok) return envelope.data;
        const payload = envelope.error;
        throw new ApiError(
          payload?.message ?? fallbackMessage,
          payload?.code ?? 'unknown_error',
          payload?.fields,
          { status: res.status },
        );
      }
      throwInvalidResponseApiError(res.status, options);
    }
    if (!res.ok) {
      throwInvalidResponseApiError(res.status, options);
    }
    const reader = res.body.getReader();
    let full: string;
    try {
      full = await readEnglishStream(reader, options?.onDelta, linked.signal);
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
    if (!full) {
      throw new ApiError(fallbackMessage, 'invalid_response', undefined, { status: res.status });
    }
    return { explanation: full };
  } finally {
    linked.cleanup();
  }
}

export interface EnglishStreamCallOptions {
  timeoutMs?: number;
  onDelta?: EnglishStreamDeltaHandler;
}

/**
 * 句子讲解流式版：优先 SSE，调用方（useEnglishLearning）失败时回退到
 * requestEnglishExplanation（Buffered），因此 Abort/超时/重试/缓存语义保持不变。
 */
export async function streamEnglishExplanation(
  articleId: string,
  input: { selectedText: string; sentences: string[]; context: string },
  signal: AbortSignal,
  options?: EnglishStreamCallOptions,
): Promise<{ explanation: string }> {
  return postEnglishLearningStream(
    `/api/articles/${encodeURIComponent(articleId)}/english-learning`,
    {
      selectedText: input.selectedText,
      sentences: input.sentences,
      context: input.context,
    },
    signal,
    { timeoutMs: options?.timeoutMs ?? ENGLISH_LEARNING_TIMEOUT_MS, onDelta: options?.onDelta },
  );
}

/**
 * 单词详细解释流式版：与 streamEnglishExplanation 同理，失败时回退到 requestWordDetail。
 */
export async function streamWordDetail(
  articleId: string,
  input: { term: string; selectedText: string; sentences: string[]; context: string },
  signal: AbortSignal,
  options?: EnglishStreamCallOptions,
): Promise<{ explanation: string }> {
  return postEnglishLearningStream(
    `/api/articles/${encodeURIComponent(articleId)}/english-learning/word-detail`,
    {
      term: input.term,
      selectedText: input.selectedText,
      sentences: input.sentences,
      context: input.context,
    },
    signal,
    { timeoutMs: options?.timeoutMs ?? ENGLISH_LEARNING_TIMEOUT_MS, onDelta: options?.onDelta },
    '暂时无法生成详细解释，请重试',
  );
}

export async function requestEnglishExplanation(
  articleId: string,
  input: { selectedText: string; sentences: string[]; context: string },
  signal: AbortSignal,
): Promise<{ explanation: string }> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/english-learning`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  }, { timeoutMs: ENGLISH_LEARNING_TIMEOUT_MS, notifyOnError: false });
}

/** 单词卡「详细解释」：服务端固定使用专用提示词，客户端不传提示词。 */
export async function requestWordDetail(
  articleId: string,
  input: { term: string; selectedText: string; sentences: string[]; context: string },
  signal: AbortSignal,
): Promise<{ explanation: string }> {
  return requestApi(
    `/api/articles/${encodeURIComponent(articleId)}/english-learning/word-detail`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal,
    },
    { timeoutMs: ENGLISH_LEARNING_TIMEOUT_MS, notifyOnError: false },
  );
}

export async function markAllRead(
  input: { feedId?: string } = {},
  options?: RequestApiOptions,
): Promise<MarkAllReadResult> {
  return requestApi(
    '/api/articles/mark-all-read',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function listFeverBatchReadTasks(options?: RequestApiOptions): Promise<{ tasks: FeverBatchReadTask[] }> {
  return requestApi('/api/articles/mark-all-read', { cache: 'no-store' }, options);
}

export async function retryFeverBatchReadTask(runId: string, options?: RequestApiOptions): Promise<{ task: FeverBatchReadTask }> {
  return requestApi(`/api/articles/mark-all-read/${encodeURIComponent(runId)}/retry`, { method: 'POST' }, options);
}

export interface FeverAccountDto {
  id: string;
  baseUrl: string;
  username: string;
  enabled: boolean;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  lastSyncAt: string | null;
  lastError: string | null;
}

export async function listFeverAccounts(
  options?: RequestApiOptions,
): Promise<FeverAccountDto[]> {
  return requestApi('/api/fever/accounts', undefined, options);
}

export async function createFeverAccount(
  input: {
    baseUrl: string;
    username: string;
    apiKey: string;
    enabled?: boolean;
    autoSyncIntervalMinutes?: number;
  },
  options?: RequestApiOptions,
): Promise<FeverAccountDto> {
  return requestApi(
    '/api/fever/accounts',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function updateFeverAccountSettings(
  input: {
    id: string;
    baseUrl: string;
    username: string;
    apiKey?: string;
    enabled: boolean;
    autoSyncIntervalMinutes: number;
  },
  options?: RequestApiOptions,
): Promise<FeverAccountDto> {
  return requestApi(
    '/api/fever/accounts',
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function deleteFeverAccount(
  accountId: string,
  options?: RequestApiOptions,
): Promise<{ deleted: boolean }> {
  return requestApi(
    `/api/fever/accounts?id=${encodeURIComponent(accountId)}`,
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function syncFeverAccountNow(
  accountId: string,
  options?: RequestApiOptions,
): Promise<{ queued: boolean; reason?: 'already_enqueued' }> {
  return requestApi(
    `/api/fever/accounts/${encodeURIComponent(accountId)}/sync`,
    {
      method: 'POST',
    },
    options,
  );
}

export interface ArticleDto {
  id: string;
  feedId: string;
  dedupeKey: string;
  title: string;
  titleOriginal: string;
  titleZh: string | null;
  link: string | null;
  author: string | null;
  publishedAt: string | null;
  contentHtml: string | null;
  contentFullHtml: string | null;
  contentFullFetchedAt: string | null;
  contentFullError: string | null;
  contentFullSourceUrl: string | null;
  aiSummary: string | null;
  aiSummaryModel: string | null;
  aiSummarizedAt: string | null;
  aiSummarySession?: ArticleAiSummarySessionSnapshotDto | null;
  aiTranslationBilingualHtml: string | null;
  aiTranslationZhHtml: string | null;
  aiTranslationModel: string | null;
  aiTranslatedAt: string | null;
  summary: string | null;
  filterStatus: 'pending' | 'passed' | 'filtered' | 'error';
  isFiltered: boolean;
  filteredBy: string[];
  isRead: boolean;
  readAt: string | null;
  isStarred: boolean;
  starredAt: string | null;
  bodyTranslationEligible?: boolean;
  bodyTranslationBlockedReason?: string | null;
  aiDigestSources?: ArticleAiDigestSourceDto[] | null;
  mediaAttachments?: ArticleMediaAttachmentDto[] | null;
}

export interface ArticleMediaAttachmentDto {
  id: string;
  url: string;
  mimeType: string;
  sizeBytes: number | null;
  durationSeconds: number | null;
}

export interface ArticleAiDigestSourceDto {
  articleId: string;
  feedId: string;
  feedTitle: string;
  title: string;
  link: string | null;
  publishedAt: string | null;
  position: number;
}

export interface ArticleSearchItemDto {
  id: string;
  feedId: string;
  feedTitle: string;
  title: string;
  titleOriginal: string | null;
  titleZh: string | null;
  summary: string;
  excerpt: string;
  publishedAt: string | null;
}

export async function searchArticles(
  input: {
    keyword: string;
    limit?: number;
  },
  options?: RequestApiOptions,
): Promise<{ items: ArticleSearchItemDto[] }> {
  const params = new URLSearchParams();
  const normalizedKeyword = input.keyword.trim().replace(/\s+/g, ' ');

  if (normalizedKeyword) {
    params.set('keyword', normalizedKeyword);
  }

  if (typeof input.limit === 'number') {
    params.set('limit', String(input.limit));
  }

  const query = params.toString();
  return requestApi(query ? `/api/articles/search?${query}` : '/api/articles/search', undefined, options);
}

export async function getArticle(
  articleId: string,
  options?: RequestApiOptions,
): Promise<ArticleDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}`, undefined, options);
}

export type ArticleTaskType = 'fulltext' | 'ai_summary' | 'ai_translate';
export type ArticleTaskStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

export interface ArticleTaskDto {
  type: ArticleTaskType;
  status: ArticleTaskStatus;
  jobId: string | null;
  requestedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  rawErrorMessage?: string | null;
}

export interface ArticleTasksDto {
  fulltext: ArticleTaskDto;
  ai_summary: ArticleTaskDto;
  ai_translate: ArticleTaskDto;
}

export async function getArticleTasks(articleId: string): Promise<ArticleTasksDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/tasks`);
}

export async function enqueueArticleFulltext(
  articleId: string,
  input?: { force?: boolean },
): Promise<{ enqueued: boolean; jobId?: string }> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/fulltext`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: Boolean(input?.force) }),
  });
}

export async function enqueueArticleAiSummary(
  articleId: string,
  input?: { force?: boolean },
): Promise<{ enqueued: boolean; jobId?: string; reason?: string; sessionId?: string }> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: Boolean(input?.force) }),
  });
}

export async function enqueueArticleAiTranslate(
  articleId: string,
  input?: { force?: boolean },
): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-translate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ force: Boolean(input?.force) }),
  });
}

export type TranslationSessionStatus = 'running' | 'succeeded' | 'partial_failed' | 'failed';
export type TranslationSegmentStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type AiSummarySessionStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ArticleAiSummarySessionSnapshotDto {
  id: string;
  status: AiSummarySessionStatus;
  draftText: string;
  finalText: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  rawErrorMessage?: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
}

export interface ArticleAiSummarySnapshotDto {
  session: ArticleAiSummarySessionSnapshotDto | null;
}

export interface ArticleAiTranslateSessionSnapshotDto {
  id: string;
  articleId: string;
  sourceHtmlHash: string;
  status: TranslationSessionStatus;
  totalSegments: number;
  translatedSegments: number;
  failedSegments: number;
  rawErrorMessage?: string | null;
  startedAt: string;
  finishedAt: string | null;
  updatedAt: string;
}

export interface ArticleAiTranslateSegmentSnapshotDto {
  id: string;
  segmentIndex: number;
  sourceText: string;
  translatedText: string | null;
  status: TranslationSegmentStatus;
  errorCode: string | null;
  errorMessage: string | null;
  rawErrorMessage?: string | null;
  updatedAt: string;
}

export interface ArticleAiTranslateSnapshotDto {
  session: ArticleAiTranslateSessionSnapshotDto | null;
  segments: ArticleAiTranslateSegmentSnapshotDto[];
}

export async function getArticleAiTranslateSnapshot(
  articleId: string,
): Promise<ArticleAiTranslateSnapshotDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-translate`);
}

export async function getArticleAiSummarySnapshot(
  articleId: string,
): Promise<ArticleAiSummarySnapshotDto> {
  return requestApi(`/api/articles/${encodeURIComponent(articleId)}/ai-summary`);
}

export async function retryArticleAiTranslateSegment(
  articleId: string,
  segmentIndex: number,
): Promise<{ enqueued: boolean; jobId?: string; reason?: string }> {
  return requestApi(
    `/api/articles/${encodeURIComponent(articleId)}/ai-translate/segments/${segmentIndex}/retry`,
    {
      method: 'POST',
    },
  );
}

export function createArticleAiTranslateEventSource(articleId: string): EventSource {
  const path = `/api/articles/${encodeURIComponent(articleId)}/ai-translate/stream`;
  return new EventSource(toAbsoluteUrl(path));
}

export function createArticleAiSummaryEventSource(articleId: string): EventSource {
  const path = `/api/articles/${encodeURIComponent(articleId)}/ai-summary/stream`;
  return new EventSource(toAbsoluteUrl(path));
}

export async function getSettings(options?: RequestApiOptions): Promise<PersistedSettings> {
  return requestApi('/api/settings', undefined, options);
}

export async function putSettings(
  input: PersistedSettings,
  options?: RequestApiOptions,
): Promise<PersistedSettings> {
  return requestApi(
    '/api/settings',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function putSettingsDraft(
  input: {
    settings: PersistedSettings;
    secrets: { aiApiKey?: string | null; translationApiKey?: string | null };
  },
  options?: RequestApiOptions,
): Promise<{ settings: PersistedSettings; hasApiKey: boolean; hasTranslationApiKey: boolean }> {
  // 一次提交全部修改，由服务端事务确保地址、模型与密钥同时生效。
  return requestApi('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }, options);
}

export async function getSystemLogs(input: {
  keyword?: string;
  page?: number;
  pageSize?: number;
}): Promise<SystemLogsPage> {
  const params = new URLSearchParams();

  if (input.keyword?.trim()) {
    params.set('keyword', input.keyword.trim());
  }

  if (typeof input.page === 'number') {
    params.set('page', String(input.page));
  }

  if (typeof input.pageSize === 'number') {
    params.set('pageSize', String(input.pageSize));
  }

  const query = params.toString();
  return requestApi(query ? `/api/logs?${query}` : '/api/logs');
}

export async function deleteSystemLogs(): Promise<{ deletedCount: number }> {
  return requestApi('/api/logs', {
    method: 'DELETE',
  });
}

export async function putAiApiKey(
  input: { apiKey: string },
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/ai/api-key',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function getAiApiKeyStatus(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi('/api/settings/ai/api-key', undefined, options);
}

export async function deleteAiApiKey(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/ai/api-key',
    {
      method: 'DELETE',
    },
    options,
  );
}

export async function putTranslationApiKey(
  input: { apiKey: string },
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/translation/api-key',
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
    options,
  );
}

export async function getTranslationApiKeyStatus(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi('/api/settings/translation/api-key', undefined, options);
}

export async function deleteTranslationApiKey(
  options?: RequestApiOptions,
): Promise<{ hasApiKey: boolean }> {
  return requestApi(
    '/api/settings/translation/api-key',
    {
      method: 'DELETE',
    },
    options,
  );
}

export function mapFeedDto(dto: FeedDtoLike, categories: Category[]): Feed {
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));
  const resolvedIconUrl =
    dto.kind === 'ai_digest' ? (dto.iconUrl ?? AI_DIGEST_ICON_URL) : dto.iconUrl;
  const normalizedTriggers = normalizeFeedAutoTriggerFlags({
    fullTextOnOpenEnabled: dto.fullTextOnOpenEnabled,
    fullTextOnFetchEnabled: dto.fullTextOnFetchEnabled,
    aiSummaryOnOpenEnabled: dto.aiSummaryOnOpenEnabled,
    aiSummaryOnFetchEnabled: Boolean(dto.aiSummaryOnFetchEnabled),
    bodyTranslateOnFetchEnabled: Boolean(dto.bodyTranslateOnFetchEnabled),
    bodyTranslateOnOpenEnabled: Boolean(dto.bodyTranslateOnOpenEnabled),
  });
  return {
    id: dto.id,
    kind: dto.kind,
    provider: dto.provider ?? 'local_rss',
    remoteManaged: dto.remoteManaged ?? dto.provider === 'fever',
    remoteSource: dto.remoteSource ?? (dto.provider === 'fever' ? 'fever' : null),
    title: dto.title,
    url: dto.url,
    siteUrl: dto.siteUrl,
    icon: resolvedIconUrl ?? undefined,
    unreadCount: 'unreadCount' in dto ? dto.unreadCount ?? 0 : 0,
    enabled: dto.enabled,
    fullTextOnOpenEnabled: Boolean(normalizedTriggers.fullTextOnOpenEnabled),
    fullTextOnFetchEnabled: Boolean(normalizedTriggers.fullTextOnFetchEnabled),
    aiSummaryOnOpenEnabled: Boolean(normalizedTriggers.aiSummaryOnOpenEnabled),
    aiSummaryOnFetchEnabled: Boolean(normalizedTriggers.aiSummaryOnFetchEnabled),
    bodyTranslateOnFetchEnabled: Boolean(normalizedTriggers.bodyTranslateOnFetchEnabled),
    bodyTranslateOnOpenEnabled: Boolean(normalizedTriggers.bodyTranslateOnOpenEnabled),
    titleTranslateEnabled: dto.titleTranslateEnabled,
    bodyTranslateEnabled: dto.bodyTranslateEnabled,
    articleListDisplayMode: dto.articleListDisplayMode,
    categoryId: dto.categoryId,
    category: dto.categoryId ? categoryNameById.get(dto.categoryId) ?? null : null,
    fetchStatus: ('lastFetchStatus' in dto ? dto.lastFetchStatus : null) ?? null,
    fetchError: ('lastFetchError' in dto ? dto.lastFetchError : null) ?? null,
    fetchRawError: ('lastFetchRawError' in dto ? dto.lastFetchRawError : null) ?? null,
    isPodcast: Boolean(dto.isPodcast),
  };
}

export function mapSnapshotArticleItem(dto: ReaderSnapshotDto['articles']['items'][number]): Article {
  const titleOriginal = dto.titleOriginal?.trim() ? dto.titleOriginal : dto.title;
  const titleZh = dto.titleZh?.trim() ? dto.titleZh : undefined;
  const effectiveTitle = titleZh ?? dto.title;

  return {
    id: dto.id,
    feedId: dto.feedId,
    title: effectiveTitle,
    titleOriginal,
    titleZh,
    content: '',
    previewImage: dto.previewImage ?? undefined,
    summary: dto.summary ?? '',
    author: dto.author ?? undefined,
    publishedAt: dto.publishedAt ?? new Date().toISOString(),
    link: dto.link ?? '',
    filterStatus: dto.filterStatus,
    isFiltered: dto.isFiltered,
    filteredBy: dto.filteredBy,
    isRead: dto.isRead,
    isStarred: dto.isStarred,
    remoteSource: dto.remoteSource ?? null,
    bodyTranslationEligible: dto.bodyTranslationEligible,
    bodyTranslationBlockedReason: dto.bodyTranslationBlockedReason,
    aiSummarySession: dto.aiSummarySession,
  };
}

export function mapArticleDto(dto: ArticleDto): Article {
  return {
    id: dto.id,
    feedId: dto.feedId,
    title: dto.title,
    titleOriginal: dto.titleOriginal,
    titleZh: dto.titleZh ?? undefined,
    content: dto.contentFullHtml ?? dto.contentHtml ?? '',
    aiSummary: dto.aiSummary ?? undefined,
    aiSummarySession: dto.aiSummarySession,
    aiTranslationBilingualHtml: dto.aiTranslationBilingualHtml ?? undefined,
    aiTranslationZhHtml: dto.aiTranslationZhHtml ?? undefined,
    summary: dto.summary ?? '',
    author: dto.author ?? undefined,
    publishedAt: dto.publishedAt ?? new Date().toISOString(),
    link: dto.link ?? '',
    filterStatus: dto.filterStatus,
    isFiltered: dto.isFiltered,
    filteredBy: dto.filteredBy,
    isRead: dto.isRead,
    isStarred: dto.isStarred,
    bodyTranslationEligible: dto.bodyTranslationEligible,
    bodyTranslationBlockedReason: dto.bodyTranslationBlockedReason,
    aiDigestSources: dto.aiDigestSources?.map((source) => ({
      articleId: source.articleId,
      feedId: source.feedId,
      feedTitle: source.feedTitle,
      title: source.title,
      link: source.link,
      publishedAt: source.publishedAt,
      position: source.position,
    })) ?? undefined,
    mediaAttachments: dto.mediaAttachments?.map((attachment) => ({
      id: attachment.id,
      url: attachment.url,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      durationSeconds: attachment.durationSeconds,
    })) ?? undefined,
  };
}
