import { TerminalManager } from "./pty/terminal-manager.js";
import { AnsiParser } from "./parser/ansi-parser.js";
import { createTabActor } from "../state/tab-machine.js";
import { RepoWatcherManager } from "./repo-watcher-manager.js";
import { CommandTracker } from "./command-tracker.js";
import { AppUI } from "../ui/app.js";
import { db } from "../db/connection.js";
import { tabs } from "../db/schema.js";
import { eq } from "drizzle-orm";
import { getGitBranch } from "../utils/git.js";
import {
  isWorktree as checkIsWorktree,
  createWorktree,
  removeWorktree as removeWorktreeDir,
} from "../utils/worktree.js";
import {
  type LayoutNode,
  splitLeaf,
  removeLeaf as removeLeafFromLayout,
  collectLeaves,
} from "./layout/layout-tree.js";

/** TabManager 依赖的外部上下文 */
export interface TabManagerContext {
  appActor: ReturnType<typeof import("../state/app-machine.js").createAppActor>;
  ui: AppUI;
  ptyManager: TerminalManager;
  cmdTracker: CommandTracker;
}

/**
 * Tab 生命周期管理器
 *
 * 统一管理 PTY/Parser/TabActor 的创建、销毁、分屏和 worktree。
 * 消除 createTab 与 splitPane 的代码重复。
 */
export class TabManager {
  private ctx: TabManagerContext;
  private parsers = new Map<string, AnsiParser>();
  private tabActors = new Map<string, ReturnType<typeof createTabActor>>();
  private dirtyTabs = new Set<string>();
  private tabCwds = new Map<string, string>();
  private tabWorktreeInfo = new Map<string, { isWorktree: boolean }>();
  private watcherManager = new RepoWatcherManager();
  private layoutRoot: LayoutNode | null = null;

  constructor(ctx: TabManagerContext) {
    this.ctx = ctx;
  }

  // ─── 布局 ───

  getLayoutRoot(): LayoutNode | null {
    return this.layoutRoot;
  }

  setLayoutRoot(root: LayoutNode | null): void {
    this.layoutRoot = root;
  }

  /** 根据 layoutRoot 重建 UI pane 并 resize 对应 PTY */
  rebuildPanes(): void {
    if (!this.layoutRoot) return;
    this.ctx.ui.buildPanes(this.layoutRoot);
    const sizes = this.ctx.ui.getVisiblePaneSizes();
    for (const [id, { cols, rows }] of sizes) {
      this.ctx.ptyManager.resize(id, cols, rows);
      this.parsers.get(id)?.resize(cols, rows);
    }
  }

  // ─── 创建 Tab ───

  createTab(name: string, cwd?: string, shell?: string, existingId?: string): string {
    const id = existingId ?? `tab-${Date.now()}`;
    const { cols, rows } = this.ctx.ui.getViewportSize();
    const parser = new AnsiParser(cols, rows);
    this.parsers.set(id, parser);

    const terminal = this.ctx.ptyManager.create(id, { cwd, shell, cols, rows });
    const tabActor = createTabActor(id, name, cwd ?? process.cwd());
    tabActor.start();
    this.tabActors.set(id, tabActor);

    terminal.onData((data) => {
      parser.feed(data);
      tabActor.send({ type: "DATA_RECEIVED", data });
      this.dirtyTabs.add(id);

      const activeId = this.ctx.appActor.getSnapshot().context.activeTabId;
      if (activeId !== id) {
        this.ctx.ui.setTabUnread(id);
      }

      // 命令边界检测
      if (activeId === id) {
        this.ctx.cmdTracker.checkPrompt(id, parser);
      }
    });

    terminal.onExit((code) => {
      tabActor.send({ type: "PROCESS_EXITED", code });
    });

    parser.onNotify(() => {
      tabActor.send({ type: "DETECT_NOTIFY_SIGNAL" });
    });

    this.ctx.ui.addTab(id, name);
    this.ctx.appActor.send({ type: "ADD_TAB", tabId: id });

    // 初始化单 pane 布局
    if (!this.layoutRoot) {
      this.layoutRoot = { type: "leaf", tabId: id };
      this.rebuildPanes();
      this.ctx.ui.focusPane(id);
    }

    // 记录 cwd 并检测 git 分支
    const resolvedCwd = cwd ?? process.cwd();
    this.tabCwds.set(id, resolvedCwd);
    this.ctx.ui.updateTabBranch(id, getGitBranch(resolvedCwd));

    // 注册 RepoWatcher
    this.watcherManager.watch(id, resolvedCwd, () => {
      const branch = getGitBranch(resolvedCwd);
      this.ctx.ui.updateTabBranch(id, branch);
    });

    // 只有新建 Tab 才写入数据库
    if (!existingId) {
      db.insert(tabs).values({
        id,
        name,
        cwd: cwd ?? process.cwd(),
        shell: shell ?? "cmd.exe",
        order: this.ctx.appActor.getSnapshot().context.tabIds.length,
      }).run();
    }

    return id;
  }

  // ─── 删除 Tab ───

  removeTab(id: string): void {
    this.watcherManager.unwatch(id);
    this.ctx.ptyManager.kill(id);
    this.parsers.delete(id);
    this.dirtyTabs.delete(id);
    this.tabCwds.delete(id);
    this.tabWorktreeInfo.delete(id);
    const actor = this.tabActors.get(id);
    actor?.stop();
    this.tabActors.delete(id);
    this.ctx.ui.removeTab(id);
    this.ctx.appActor.send({ type: "REMOVE_TAB", tabId: id });
    db.delete(tabs).where(eq(tabs.id, id)).run();

    // 更新布局
    if (this.layoutRoot) {
      this.layoutRoot = removeLeafFromLayout(this.layoutRoot, id);
      if (this.layoutRoot) {
        this.rebuildPanes();
      } else {
        this.layoutRoot = null;
      }
    }
  }

  // ─── 分屏 ───

  splitPane(targetId: string, direction: "horizontal" | "vertical"): void {
    const newId = `tab-${Date.now()}`;
    const name = "Terminal";

    if (!this.layoutRoot) {
      this.layoutRoot = { type: "leaf", tabId: targetId };
    }

    this.layoutRoot = splitLeaf(this.layoutRoot, targetId, newId, direction);

    this.ctx.ui.buildPanes(this.layoutRoot);
    const size = this.ctx.ui.getPaneSize(newId);
    const parser = new AnsiParser(size.cols, size.rows);
    this.parsers.set(newId, parser);

    const terminal = this.ctx.ptyManager.create(newId, { cols: size.cols, rows: size.rows });
    const tabActor = createTabActor(newId, name, process.cwd());
    tabActor.start();
    this.tabActors.set(newId, tabActor);

    terminal.onData((data) => {
      parser.feed(data);
      tabActor.send({ type: "DATA_RECEIVED", data });
      this.dirtyTabs.add(newId);
    });

    terminal.onExit((code) => {
      tabActor.send({ type: "PROCESS_EXITED", code });
    });

    parser.onNotify(() => {
      tabActor.send({ type: "DETECT_NOTIFY_SIGNAL" });
    });

    this.ctx.ui.addTab(newId, name);
    this.ctx.appActor.send({ type: "ADD_TAB", tabId: newId });
    this.tabCwds.set(newId, process.cwd());

    // 焦点切到新 pane
    this.ctx.ui.focusPane(newId);
    this.ctx.appActor.send({ type: "FOCUS_PANE", tabId: newId });
    this.ctx.appActor.send({ type: "SWITCH_TAB", tabId: newId });
    this.ctx.ui.setActiveTab(newId);

    this.rebuildPanes();

    db.insert(tabs).values({
      id: newId,
      name,
      cwd: process.cwd(),
      shell: "cmd.exe",
      order: this.ctx.appActor.getSnapshot().context.tabIds.length,
    }).run();
  }

  // ─── Worktree 管理 ───

  async createWorktreeTab(params: {
    branch: string;
    tabName?: string;
    baseTabId?: string;
  }): Promise<{ tabId: string; path: string; branch: string }> {
    let mainRepoPath: string;
    if (params.baseTabId) {
      mainRepoPath = this.tabCwds.get(params.baseTabId) ?? process.cwd();
    } else {
      const activeId = this.ctx.appActor.getSnapshot().context.activeTabId;
      mainRepoPath = activeId ? (this.tabCwds.get(activeId) ?? process.cwd()) : process.cwd();
    }

    const { path: worktreePath, branch } = createWorktree({
      mainRepoPath,
      branch: params.branch,
    });

    const tabName = params.tabName ?? branch;
    const tabId = this.createTab(tabName, worktreePath);

    this.tabWorktreeInfo.set(tabId, { isWorktree: true });
    this.ctx.ui.updateTabWorktree(tabId, true);

    db.update(tabs).set({ isWorktree: true }).where(eq(tabs.id, tabId)).run();

    return { tabId, path: worktreePath, branch };
  }

  async removeWorktreeTab(tabId: string, force = false): Promise<{ ok: boolean }> {
    const cwd = this.tabCwds.get(tabId);
    if (!cwd) throw new Error(`Tab ${tabId} not found`);

    const removed = removeWorktreeDir(cwd, force);
    if (!removed && !force) {
      throw new Error("移除 worktree 失败，可能存在未提交的更改。使用 force=true 强制移除");
    }

    this.tabWorktreeInfo.delete(tabId);
    this.removeTab(tabId);
    return { ok: true };
  }

  isWorktreeTab(tabId: string): boolean {
    return this.tabWorktreeInfo.get(tabId)?.isWorktree ?? false;
  }

  /** 恢复 worktree 元数据（会话恢复时调用） */
  restoreWorktreeInfo(tabId: string, isWorktree: boolean): void {
    if (isWorktree) {
      this.tabWorktreeInfo.set(tabId, { isWorktree: true });
      this.ctx.ui.updateTabWorktree(tabId, true);
    }
  }

  // ─── Getter 方法 ───

  getActiveTabId(): string | null {
    return this.ctx.appActor.getSnapshot().context.activeTabId;
  }

  getTabIds(): string[] {
    return this.ctx.appActor.getSnapshot().context.tabIds as string[];
  }

  getTabName(id: string): string {
    const actor = this.tabActors.get(id);
    return actor?.getSnapshot().context.name ?? "Tab";
  }

  getTabCwd(id: string): string | undefined {
    return this.tabCwds.get(id);
  }

  getParser(id: string): AnsiParser | undefined {
    return this.parsers.get(id);
  }

  getTabActor(id: string): ReturnType<typeof createTabActor> | undefined {
    return this.tabActors.get(id);
  }

  isDirty(tabId: string): boolean {
    return this.dirtyTabs.has(tabId);
  }

  markDirty(tabId: string): void {
    this.dirtyTabs.add(tabId);
  }

  clearDirty(tabId: string): void {
    this.dirtyTabs.delete(tabId);
  }

  getDirtyTabIds(): string[] {
    return [...this.dirtyTabs];
  }

  getVisibleLeaves(): string[] {
    if (!this.layoutRoot) return [];
    return collectLeaves(this.layoutRoot);
  }

  getTabCwdMap(): Map<string, string> {
    return this.tabCwds;
  }

  refreshGitBranches(): void {
    for (const [id, cwd] of this.tabCwds) {
      const branch = getGitBranch(cwd);
      this.ctx.ui.updateTabBranch(id, branch);
    }
  }

  resizeActive(): void {
    const activeId = this.ctx.appActor.getSnapshot().context.activeTabId;
    if (activeId) {
      const size = this.ctx.ui.getViewportSize();
      this.ctx.ptyManager.resize(activeId, size.cols, size.rows);
      this.parsers.get(activeId)?.resize(size.cols, size.rows);
    }
  }

  killAll(): void {
    this.watcherManager.disposeAll();
    this.ctx.ptyManager.killAll();
  }
}
