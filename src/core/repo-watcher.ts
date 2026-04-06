import { watch, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * 监听 cwd 下 .git 目录的变化，防抖触发回调。
 * 纯感知层：不解析 git 状态，只通知"有变化"。
 *
 * 设计原则：文件系统是唯一的真相来源。
 * cmux-bun 只是真相的投影仪，Claude 是操作员。
 * "王不见王" —— 让 Claude 处理 Git Logic，cmux 只做 Git Awareness。
 */
export class RepoWatcher {
  private cwd: string;
  private debounceMs: number;
  private onChange: () => void;
  private watcher: ReturnType<typeof watch> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(cwd: string, onChange: () => void, debounceMs = 500) {
    this.cwd = cwd;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.start();
  }

  private start() {
    const gitDir = join(this.cwd, ".git");
    if (!existsSync(gitDir)) return;

    try {
      this.watcher = watch(gitDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        // 只关注关键文件的变动
        const keyFiles = ["HEAD", "index", "stash", "MERGE_HEAD", "REBASE_HEAD"];
        const normalized = filename.replace(/\\/g, "/");
        if (
          keyFiles.some((f) => normalized === f) ||
          normalized.startsWith("refs/")
        ) {
          this.schedule();
        }
      });
    } catch {
      // .git 目录可能无权限或已删除，静默忽略
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.onChange();
    }, this.debounceMs);
  }

  updateCwd(newCwd: string) {
    if (newCwd === this.cwd) return;
    this.dispose();
    this.cwd = newCwd;
    this.start();
  }

  dispose() {
    this.watcher?.close();
    this.watcher = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
