import { listDictionaries } from '@/lib/api/apiClient';

/**
 * 已启用扩展词典的数量缓存。
 *
 * 查词需要知道「是否装了额外词典」来决定先查服务端还是先查内置词库，
 * 但每次查词都请求列表太浪费；词典管理面板拿到最新列表后同步这里即可。
 *
 * TTL 策略：面板同步的值最多信任 60s，过期后下次查词时后台重新校验一次，
 * 避免「刚装好词典却一直走内置词库」的 stale 状态自愈不了。
 */
export const INSTALLED_DICTIONARY_COUNT_TTL_MS = 60_000;

let installedReadyCount: number | null = null;
let installedReadyAt = 0;
let installedReadyPromise: Promise<number> | null = null;
let revision = 0;
let generation = 0;

/** 立即返回最近状态；首次未知时由查词直接走服务端，刷新不阻塞查询。 */
export function getInstalledDictionarySnapshot(): { count: number | null; revision: number } {
  const snapshot = { count: installedReadyCount, revision };
  if (!isCountFresh(Date.now())) void getInstalledDictionaryCount();
  return snapshot;
}

export function countReadyInstalledDictionaries(
  items: { builtin: boolean; status: string; enabled: boolean }[],
): number {
  return items.filter((item) => !item.builtin && item.status === 'ready' && item.enabled).length;
}

export function setInstalledDictionaryCount(count: number): void {
  generation += 1;
  revision += 1;
  installedReadyCount = count;
  installedReadyAt = Date.now();
  installedReadyPromise = null;
}

export function resetInstalledDictionaryCount(): void {
  generation += 1;
  revision += 1;
  installedReadyCount = null;
  installedReadyAt = 0;
  installedReadyPromise = null;
}

function isCountFresh(now: number): boolean {
  return installedReadyAt > 0 && now - installedReadyAt < INSTALLED_DICTIONARY_COUNT_TTL_MS;
}

export async function getInstalledDictionaryCount(): Promise<number> {
  const now = Date.now();
  if (isCountFresh(now)) return installedReadyCount ?? 0;
  if (!installedReadyPromise) {
    const startedGeneration = generation;
    const task = listDictionaries({ notifyOnError: false })
      .then(({ items }) => {
        const count = countReadyInstalledDictionaries(items);
        // 面板更新或重置后，旧请求不能覆盖较新的状态。
        if (generation === startedGeneration) {
          if (installedReadyCount !== count) revision += 1;
          installedReadyCount = count;
          installedReadyAt = Date.now();
        }
        return count;
      })
      .catch(() => {
        // 短暂故障保留最近状态，并退避一小段时间，避免连续查词重复请求列表。
        if (generation === startedGeneration) installedReadyAt = Date.now() - INSTALLED_DICTIONARY_COUNT_TTL_MS + 5_000;
        return installedReadyCount ?? 0;
      })
      .finally(() => {
        if (installedReadyPromise === task) installedReadyPromise = null;
      });
    installedReadyPromise = task;
  }
  return installedReadyPromise;
}
