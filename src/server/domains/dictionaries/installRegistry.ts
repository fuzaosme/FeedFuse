/**
 * 记录进程内正在执行的词典安装任务。
 *
 * 数据库里的 status 是持久状态，但在进程重启后可能停留在 installing；
 * 因此列表接口会用这里的实时信息把「没有对应任务的 installing」纠正为失败。
 */
const running = new Map<string, AbortController>();

export function registerInstall(id: string, controller: AbortController): void {
  running.get(id)?.abort();
  running.set(id, controller);
}

export function unregisterInstall(id: string): void {
  running.delete(id);
}

export function isInstalling(id: string): boolean {
  return running.has(id);
}

export function activeInstallIds(): string[] {
  return [...running.keys()];
}

export function runningInstallCount(): number {
  return running.size;
}

export function abortInstall(id: string): boolean {
  const controller = running.get(id);
  if (!controller) return false;
  controller.abort();
  return true;
}
