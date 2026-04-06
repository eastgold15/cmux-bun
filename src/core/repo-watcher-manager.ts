import { RepoWatcher } from "./repo-watcher.js";
import { resolveGitDir } from "../utils/worktree.js";

/**
 * RepoWatcher 管理器：按 gitDir 去重，引用计数。
 * 多个 Tab 指向同一 gitDir 时复用同一个 RepoWatcher。
 */
export class RepoWatcherManager {
  private watchers = new Map<string, {
    watcher: RepoWatcher;
    refCount: number;
    tabIds: Set<string>;
  }>();

  private tabToGitDir = new Map<string, string>();

  /** 为 tab 注册 git 监听。onChange 在 git 变化时触发。 */
  watch(tabId: string, cwd: string, onChange: () => void): void {
    // 先清理旧的绑定
    this.unwatch(tabId);

    const gitDir = resolveGitDir(cwd);
    if (!gitDir) return;

    this.tabToGitDir.set(tabId, gitDir);

    const existing = this.watchers.get(gitDir);
    if (existing) {
      existing.refCount++;
      existing.tabIds.add(tabId);
    } else {
      const watcher = new RepoWatcher(cwd, onChange, 500, gitDir);
      this.watchers.set(gitDir, {
        watcher,
        refCount: 1,
        tabIds: new Set([tabId]),
      });
    }
  }

  /** 取消 tab 的 git 监听。引用计数归零时销毁 watcher。 */
  unwatch(tabId: string): void {
    const gitDir = this.tabToGitDir.get(tabId);
    if (!gitDir) return;

    const entry = this.watchers.get(gitDir);
    if (!entry) return;

    entry.refCount--;
    entry.tabIds.delete(tabId);

    if (entry.refCount <= 0) {
      entry.watcher.dispose();
      this.watchers.delete(gitDir);
    }

    this.tabToGitDir.delete(tabId);
  }

  /** 关闭所有 watcher */
  disposeAll(): void {
    for (const [, entry] of this.watchers) {
      entry.watcher.dispose();
    }
    this.watchers.clear();
    this.tabToGitDir.clear();
  }
}
