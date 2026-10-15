import { externalHttpTransport } from './externalHttpTransport';
import type { SafeUrlChecker } from './fetchExternalText';

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FetchBytesOkResult {
  kind: 'ok';
  status: number;
  finalUrl: string;
  contentType: string | null;
  body: Buffer;
}

export type FetchBytesHopResult = { kind: 'redirect'; nextUrl: string } | FetchBytesOkResult;

export interface FetchExternalBytesOptions {
  /**
   * 空闲超时：每收到一段数据都会重新计时，避免大文件下载被整体超时误杀，
   * 同时在连接完全停滞时及时释放。
   */
  idleTimeoutMs: number;
  headers: Record<string, string>;
  maxBytes: number;
  maxRedirects: number;
  isSafeUrl: SafeUrlChecker;
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void;
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : value?.[0] ?? null;
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function assertSafeUrl(url: string, isSafeUrl: SafeUrlChecker): Promise<void> {
  if (!(await isSafeUrl(url))) {
    throw new Error('Unsafe URL');
  }
}

async function fetchBytesHop(
  url: string,
  options: {
    idleTimeoutMs: number;
    headers: Record<string, string>;
    maxBytes: number;
    onProgress?: FetchExternalBytesOptions['onProgress'];
  },
): Promise<FetchBytesHopResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const armTimer = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => controller.abort(), options.idleTimeoutMs);
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  armTimer();

  try {
    const req = externalHttpTransport.stream(url, {
      method: 'GET',
      followRedirect: false,
      headers: options.headers,
      signal: controller.signal,
    });

    return await new Promise<FetchBytesHopResult>((resolve, reject) => {
      let settled = false;
      let status = 0;
      let finalUrl = url;
      let contentType: string | null = null;
      const chunks: Buffer[] = [];
      let received = 0;

      const safeResolve = (value: FetchBytesHopResult) => {
        if (settled) return;
        settled = true;
        clearTimer();
        resolve(value);
      };
      const safeReject = (err: unknown) => {
        if (settled) return;
        settled = true;
        clearTimer();
        reject(err);
      };

      req.on('close', clearTimer);
      req.on('error', safeReject);

      req.on('response', (res) => {
        status = res.statusCode;
        finalUrl = res.url || finalUrl;
        contentType = getHeaderValue(res.headers['content-type']);

        if (!REDIRECT_STATUSES.has(status)) {
          const total = parseContentLength(getHeaderValue(res.headers['content-length']));
          if (total !== null && total > options.maxBytes) {
            req.destroy(new Error('Response too large'));
            return;
          }
          options.onProgress?.(0, total);
          return;
        }

        const location = getHeaderValue(res.headers.location);
        if (!location) {
          safeReject(new Error('Missing redirect location'));
          req.destroy();
          return;
        }

        try {
          // 手动处理重定向，确保下一跳请求发出前能先做 SSRF 校验。
          safeResolve({ kind: 'redirect', nextUrl: new URL(location, url).toString() });
        } catch (err) {
          safeReject(err);
        }
        req.destroy();
      });

      req.on('data', (chunk) => {
        if (settled) return;
        armTimer();
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += buf.byteLength;
        if (received > options.maxBytes) {
          req.destroy(new Error('Response too large'));
          return;
        }
        chunks.push(buf);
        options.onProgress?.(received, null);
      });

      req.on('end', () => {
        safeResolve({
          kind: 'ok',
          status,
          finalUrl,
          contentType,
          body: Buffer.concat(chunks),
        });
      });
    });
  } finally {
    clearTimer();
  }
}

export async function fetchBytesWithValidatedRedirects(
  url: string,
  options: FetchExternalBytesOptions,
): Promise<FetchBytesOkResult> {
  let currentUrl = url;
  let redirects = 0;

  while (true) {
    await assertSafeUrl(currentUrl, options.isSafeUrl);
    const hop = await fetchBytesHop(currentUrl, options);

    if (hop.kind === 'ok') {
      return hop;
    }

    if (redirects >= options.maxRedirects) {
      throw new Error('Too many redirects');
    }

    redirects += 1;
    currentUrl = hop.nextUrl;
  }
}
