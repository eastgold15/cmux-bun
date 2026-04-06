import type { TerminalManager } from "./pty/terminal-manager.js";
import type { AppUI } from "../ui/app.js";
import type { CommandTracker } from "./command-tracker.js";
import type { TabManager } from "./tab-manager.js";
import { HistoryOverlay } from "../ui/history-overlay.js";
import { getGitBranch } from "../utils/git.js";
import { db } from "../db/connection.js";
import { tabs } from "../db/schema.js";
import { eq } from "drizzle-orm";

/** KeyHandler 依赖的外部上下文 */
export interface KeyHandlerContext {
  appActor: ReturnType<typeof import("../state/app-machine.js").createAppActor>;
  ui: AppUI;
  ptyManager: TerminalManager;
  cmdTracker: CommandTracker;
  tabManager: TabManager;
  renderer: any; // CliRenderer from @opentui/core
  gracefulExit: () => void;
}

/**
 * 键盘事件处理器
 *
 * 统一管理键盘快捷键分发和交互模式（搜索/重命名/确认）状态。
 */
export class KeyHandler {
  private ctx: KeyHandlerContext;
  private isSearchMode = false;
  private historyOverlay: HistoryOverlay | null = null;

  constructor(ctx: KeyHandlerContext) {
    this.ctx = ctx;
  }

  /** 处理按键事件，返回 true 表示已消费 */
  handle(key: string): void {
    const state = this.ctx.appActor.getSnapshot();
    const activeId = state.context.activeTabId;

    // 搜索模式：拦截所有按键
    if (this.isSearchMode && this.historyOverlay) {
      this.handleSearchMode(key, activeId);
      return;
    }

    // 重命名模式
    if (this.ctx.ui.isRenaming) {
      this.ctx.ui.handleRenameKey(key);
      return;
    }

    // 确认模式
    if (this.ctx.ui.isConfirming) {
      this.ctx.ui.handleConfirmKey(key);
      return;
    }

    // Alt 组合键
    if (key.startsWith("\x1b") && key.length === 2) {
      this.handleAltCombo(key, activeId);
      return;
    }

    // Ctrl+R: 打开历史搜索
    if (key === "\x12") {
      this.enterSearchMode();
      return;
    }

    // Ctrl+C 退出
    if (key === "\x03") {
      this.ctx.gracefulExit();
    }

    // 命令追踪
    if (activeId) {
      const cwd = this.ctx.tabManager.getTabCwd(activeId) ?? process.cwd();
      this.ctx.cmdTracker.feedKey(key, activeId, cwd);
    }

    // 转发给当前 PTY
    if (activeId) {
      const terminal = this.ctx.ptyManager.get(activeId);
      terminal?.write(key);
      this.ctx.tabManager.getTabActor(activeId)?.send({ type: "USER_INPUT", key });
    }
  }

  /** 搜索模式下的按键处理 */
  private handleSearchMode(key: string, activeId: string | null): void {
    if (key === "\x1b" || key === "\x03") {
      this.exitSearchMode();
    } else if (key === "\r") {
      const selected = this.historyOverlay!.getSelected();
      this.exitSearchMode();
      if (selected && activeId) {
        const terminal = this.ctx.ptyManager.get(activeId);
        terminal?.write(selected);
        this.ctx.cmdTracker.setPendingCommand(selected);
      }
    } else if (key === "\x1b[A") {
      this.historyOverlay!.moveUp();
    } else if (key === "\x1b[B") {
      this.historyOverlay!.moveDown();
    } else if (key === "\x7f" || key === "\x08") {
      this.historyOverlay!.backspaceQuery();
      this.updateSearchStatusBar();
    } else if (key.length >= 1 && !/^\x1b/.test(key) && key.charCodeAt(0) >= 32) {
      this.historyOverlay!.appendQuery(key);
      this.updateSearchStatusBar();
    }
  }

  /** Alt 组合键处理 */
  private handleAltCombo(key: string, activeId: string | null): void {
    const num = key.charCodeAt(1) - 49;
    if (num >= 0 && num < 9) {
      this.switchTabByIndex(num);
      return;
    }

    switch (key) {
      case "\x1br": // Alt+r: 重命名
        this.handleRename(activeId);
        break;
      case "\x1bw": // Alt+w: 关闭 Tab
        this.handleCloseTab(activeId);
        break;
      case "\x1b\\": // Alt+\: 水平分屏
        if (activeId) this.ctx.tabManager.splitPane(activeId, "horizontal");
        break;
      case "\x1b-": // Alt+-: 垂直分屏
        if (activeId) this.ctx.tabManager.splitPane(activeId, "vertical");
        break;
      case "\x1bx": // Alt+x: 关闭 pane
        this.handleClosePane(activeId);
        break;
    }
  }

  /** 切换到指定索引的 Tab */
  private switchTabByIndex(index: number): void {
    this.ctx.appActor.send({ type: "SWITCH_TAB_INDEX", index });
    const newActiveId = this.ctx.appActor.getSnapshot().context.activeTabId;
    if (newActiveId) {
      this.ctx.ui.setActiveTab(newActiveId);
      const parser = this.ctx.tabManager.getParser(newActiveId);
      if (parser) {
        this.ctx.ui.updateTerminalGrid(parser.getGrid());
      }
      const cwd = this.ctx.tabManager.getTabCwd(newActiveId);
      if (cwd) this.ctx.ui.updateTabBranch(newActiveId, getGitBranch(cwd));
    }
  }

  /** 处理重命名 */
  private handleRename(activeId: string | null): void {
    if (!activeId) return;
    const actor = this.ctx.tabManager.getTabActor(activeId);
    const currentName = actor?.getSnapshot().context.name ?? "Tab";
    this.ctx.ui.showRenameOverlay(currentName).then((newName) => {
      if (newName && activeId) {
        this.ctx.ui.updateTabName(activeId, newName);
        const actor = this.ctx.tabManager.getTabActor(activeId);
        if (actor) {
          (actor.getSnapshot().context as any).name = newName;
        }
        db.update(tabs).set({ name: newName }).where(eq(tabs.id, activeId)).run();
      }
    });
  }

  /** 处理关闭 Tab */
  private handleCloseTab(activeId: string | null): void {
    if (!activeId) return;
    const actor = this.ctx.tabManager.getTabActor(activeId);
    const tabName = actor?.getSnapshot().context.name ?? "Tab";
    const ptyInstance = this.ctx.ptyManager.get(activeId);
    if (ptyInstance) {
      this.ctx.ui.showConfirmOverlay(tabName).then((confirmed) => {
        if (confirmed && activeId) {
          this.ctx.tabManager.removeTab(activeId);
        }
      });
    } else {
      this.ctx.tabManager.removeTab(activeId);
    }
  }

  /** 处理关闭 Pane */
  private handleClosePane(activeId: string | null): void {
    if (!activeId || !this.ctx.tabManager.getLayoutRoot()) return;
    const leaves = this.ctx.tabManager.getVisibleLeaves();
    if (leaves.length > 1) {
      this.ctx.tabManager.removeTab(activeId);
    }
  }

  /** 进入搜索模式 */
  private enterSearchMode(): void {
    this.isSearchMode = true;
    this.historyOverlay = new HistoryOverlay(this.ctx.renderer);
    this.historyOverlay!.show();
    this.ctx.ui.updateStatusBar(" 搜索: | Enter:插入 | Esc:取消 | ↑↓:选择");
  }

  /** 退出搜索模式 */
  private exitSearchMode(): void {
    this.historyOverlay?.hide();
    this.historyOverlay = null;
    this.isSearchMode = false;
    this.ctx.ui.updateStatusBar(" Alt+1-9:Tab | Alt+r:重命名 | Alt+w:关闭 | Ctrl+R:搜索 | Ctrl+C:退出");
  }

  /** 更新搜索状态栏 */
  private updateSearchStatusBar(): void {
    if (this.historyOverlay) {
      this.ctx.ui.updateStatusBar(` 搜索: ${this.historyOverlay.currentQuery} | Enter:插入 | Esc:取消 | ↑↓:选择`);
    }
  }

  /** 当前是否处于搜索模式 */
  getSearchMode(): boolean {
    return this.isSearchMode;
  }
}
