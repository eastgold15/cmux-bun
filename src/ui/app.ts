import {
  BoxRenderable,
  TextRenderable,
  StyledText,
  TextAttributes,
  RGBA,
} from "@opentui/core";
import type { CliRenderer, KeyEvent, TextChunk, CursorStyleOptions } from "@opentui/core";
import type { TabState, AgentLifecycle } from "../contracts/index.js";
import type { Cell, CursorInfo } from "../core/parser/ansi-parser.js";
import type { LayoutNode, Rect } from "../core/layout/layout-tree.js";
import { resolveRects } from "../core/layout/layout-tree.js";
import { theme } from "../theme.js";

const SIDEBAR_WIDTH = 22;

interface PaneUI {
  box: BoxRenderable;
  text: TextRenderable;
}

export class AppUI {
  private renderer: CliRenderer;
  private sidebar!: BoxRenderable;
  private paneContainer!: BoxRenderable;
  private statusBar!: BoxRenderable;
  private statusText!: TextRenderable;
  private tabItems: Map<string, { box: BoxRenderable; text: TextRenderable; cwdText: TextRenderable; branchText: TextRenderable; hasUnread: boolean; isWorktree: boolean; name: string }> = new Map();
  private panes: Map<string, PaneUI> = new Map();

  private activeTabId: string | null = null;
  private focusedPaneId: string | null = null;
  private tabStates: Map<string, TabState> = new Map();
  private agentStatuses: Map<string, AgentLifecycle> = new Map();
  private agentTasks: Map<string, string> = new Map();

  private onKeyHandler: ((key: string) => void) | null = null;
  private onResizeHandler: ((cols: number, rows: number) => void) | null = null;

  // Overlay: 重命名
  private renameOverlay: BoxRenderable | null = null;
  private renameInput: TextRenderable | null = null;
  private renameBuffer = "";
  private renameResolve: ((value: string | null) => void) | null = null;

  // Overlay: 关闭确认
  private confirmOverlay: BoxRenderable | null = null;
  private confirmResolve: ((value: boolean) => void) | null = null;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
    this.buildLayout();
  }

  private buildLayout() {
    const width = this.renderer.terminalWidth;
    const height = this.renderer.terminalHeight;
    const root = this.renderer.root;

    // 侧边栏：固定宽度，左侧
    this.sidebar = new BoxRenderable(this.renderer, {
      id: "sidebar",
      position: "absolute",
      left: 0,
      top: 0,
      width: SIDEBAR_WIDTH,
      height: height - 1,
      border: true,
      borderStyle: "single",
      borderColor: theme.sidebar.border,
      backgroundColor: theme.sidebar.bg,
      flexDirection: "column",
    });

    const title = new TextRenderable(this.renderer, {
      id: "sidebar-title",
      content: " cmux-bun",
      fg: theme.sidebar.title,
    });
    this.sidebar.add(title);

    // 视窗容器：填满 sidebar 右侧空间，子 pane 由布局树动态管理
    this.paneContainer = new BoxRenderable(this.renderer, {
      id: "pane-container",
      position: "absolute",
      left: SIDEBAR_WIDTH,
      top: 0,
      width: width - SIDEBAR_WIDTH,
      height: height - 1,
      backgroundColor: theme.terminal.bg,
    });

    // 状态栏：底部一行
    this.statusBar = new BoxRenderable(this.renderer, {
      id: "status-bar",
      position: "absolute",
      left: 0,
      bottom: 0,
      width,
      height: 1,
      backgroundColor: theme.statusBar.bg,
      flexDirection: "row",
    });

    this.statusText = new TextRenderable(this.renderer, {
      id: "status-text",
      content: " Alt+1-9:Tab | Alt+r:重命名 | Alt+w:关闭 | Ctrl+R:搜索 | Ctrl+C:退出",
      fg: theme.statusBar.fg,
    });
    this.statusBar.add(this.statusText);

    root.add(this.sidebar);
    root.add(this.paneContainer);
    root.add(this.statusBar);

    // 键盘监听（通过 OpenTUI keyInput 事件系统）
    this.renderer.keyInput.on("keypress", (key: KeyEvent) => {
      this.onKeyHandler?.(key.sequence);
    });

    // 窗口大小变化
    this.renderer.on("resize", ({ width, height }: { width: number; height: number }) => {
      this.sidebar.height = height - 1;
      this.paneContainer.width = width - SIDEBAR_WIDTH;
      this.paneContainer.height = height - 1;
      this.statusBar.width = width;

      // 通知 main.ts 重新计算所有 pane 尺寸
      this.onResizeHandler?.(width - SIDEBAR_WIDTH, height - 1);
    });
  }

  onKey(handler: (key: string) => void) {
    this.onKeyHandler = handler;
  }

  onResize(handler: (cols: number, rows: number) => void) {
    this.onResizeHandler = handler;
  }

  addTab(tabId: string, name: string, cwd?: string) {
    const tabItem = new BoxRenderable(this.renderer, {
      id: `tab-${tabId}`,
      width: SIDEBAR_WIDTH - 2,
      height: 2,
      backgroundColor: theme.sidebar.bg,
      flexDirection: "column",
    });

    const tabText = new TextRenderable(this.renderer, {
      id: `tab-text-${tabId}`,
      content: ` ${name}`,
      fg: theme.sidebar.tabInactiveFg,
    });

    const cwdText = new TextRenderable(this.renderer, {
      id: `tab-cwd-${tabId}`,
      content: cwd ? ` ${this.shortenCwd(cwd)}` : "",
      fg: theme.sidebar.tabCwdFg,
    });

    const branchText = new TextRenderable(this.renderer, {
      id: `tab-branch-${tabId}`,
      content: "",
      fg: "#55aa55",
    });

    tabItem.add(tabText);
    tabItem.add(cwdText);
    tabItem.add(branchText);
    this.sidebar.add(tabItem);
    this.tabItems.set(tabId, { box: tabItem, text: tabText, cwdText, branchText, hasUnread: false, isWorktree: false, name });
  }

  private shortenCwd(cwd: string): string {
    const parts = cwd.replace(/\\/g, "/").split("/");
    return parts.slice(-2).join("/");
  }

  removeTab(tabId: string) {
    const item = this.tabItems.get(tabId);
    if (item) {
      this.sidebar.remove(item.box.id);
      item.box.destroy();
      this.tabItems.delete(tabId);
    }
    this.tabStates.delete(tabId);
    this.agentStatuses.delete(tabId);
    this.agentTasks.delete(tabId);
    this.removePane(tabId);
  }

  setActiveTab(tabId: string) {
    const prevItem = this.activeTabId ? this.tabItems.get(this.activeTabId) : null;
    if (prevItem) {
      prevItem.box.backgroundColor = theme.sidebar.bg;
      prevItem.text.fg = theme.sidebar.tabInactiveFg;
    }

    this.activeTabId = tabId;
    this.focusedPaneId = tabId;
    const current = this.tabItems.get(tabId);
    if (current) {
      current.hasUnread = false;
      const state = this.tabStates.get(tabId);
      const borderColor = state?.hasAlert ? theme.indicator.attention : state?.isBusy ? theme.indicator.busy : theme.indicator.active;
      current.box.backgroundColor = theme.sidebar.tabActiveBg;
      current.text.fg = borderColor;
      this.updateTabIndicator(tabId, current, state);
    }

    this.updatePaneBorders();
  }

  setTabUnread(tabId: string) {
    if (tabId === this.activeTabId) return;
    const item = this.tabItems.get(tabId);
    if (item) {
      item.hasUnread = true;
      this.updateTabIndicator(tabId, item, this.tabStates.get(tabId));
    }
  }

  /** 更新 Tab 的 Agent 生命周期状态 */
  updateAgentStatus(tabId: string, status: AgentLifecycle, task?: string) {
    this.agentStatuses.set(tabId, status);
    if (task !== undefined) this.agentTasks.set(tabId, task);

    const item = this.tabItems.get(tabId);
    if (item) this.updateTabIndicator(tabId, item, this.tabStates.get(tabId));
    this.updatePaneBorders();

    // success 状态 2 秒后自动回到 idle
    if (status === "success") {
      setTimeout(() => {
        if (this.agentStatuses.get(tabId) === "success") {
          this.updateAgentStatus(tabId, "idle");
        }
      }, 2000);
    }

    // error 时在状态栏显示错误信息
    if (status === "error") {
      const taskDesc = this.agentTasks.get(tabId) ?? "";
      this.updateStatusBar(` \u2717 Agent Error: ${taskDesc}`);
    }
  }

  private updateTabIndicator(tabId: string, item: { text: TextRenderable; hasUnread: boolean; name: string }, state?: TabState) {
    const isActive = tabId === this.activeTabId;
    const agentStatus = this.agentStatuses.get(tabId);
    let indicator = " ";

    // Agent lifecycle 优先级最高
    if (agentStatus === "busy") {
      indicator = "\u23F3";
      item.text.fg = theme.indicator.busy;
    } else if (agentStatus === "success") {
      indicator = "\u2713";
      item.text.fg = "#55ff55";
    } else if (agentStatus === "error") {
      indicator = "\u2717";
      item.text.fg = "#ff5555";
    } else if (state?.hasAlert) {
      indicator = "!";
      item.text.fg = theme.indicator.attention;
    } else if (state?.isBusy) {
      indicator = "*";
      item.text.fg = theme.indicator.busy;
    } else if (item.hasUnread) {
      indicator = "\u25CF";
      item.text.fg = theme.indicator.unread;
    } else if (isActive) {
      item.text.fg = theme.indicator.active;
    } else {
      item.text.fg = theme.indicator.idle;
    }

    // busy 时在名称后追加任务描述
    if (agentStatus === "busy") {
      const task = this.agentTasks.get(tabId) ?? "";
      const suffix = task.length > 0 ? ` \u2026${task.slice(0, 20)}` : "";
      item.text.content = `${indicator} ${item.name}${suffix}`;
    } else {
      item.text.content = `${indicator} ${item.name}`;
    }
  }

  /** 更新 sidebar tab 的 git 分支显示 */
  updateTabBranch(tabId: string, branch: string | null) {
    const item = this.tabItems.get(tabId);
    if (!item) return;
    const color = item.isWorktree ? theme.worktree.branchFg : "#55aa55";
    item.branchText.fg = color;
    item.branchText.content = branch ? ` \uE0A0 ${branch}` : "";
  }

  /** 标记/取消 worktree 状态（影响分支显示颜色） */
  updateTabWorktree(tabId: string, isWorktree: boolean) {
    const item = this.tabItems.get(tabId);
    if (!item) return;
    item.isWorktree = isWorktree;
    // worktree Tab 的分支文本使用特殊颜色
    if (isWorktree) {
      item.branchText.fg = theme.worktree.branchFg;
    } else {
      item.branchText.fg = "#55aa55";
    }
  }

  updateTerminalOutput(text: string) {
    if (this.focusedPaneId) {
      const pane = this.panes.get(this.focusedPaneId);
      pane?.text && (pane.text.content = text);
    }
  }

  updatePaneOutput(paneId: string, text: string) {
    const pane = this.panes.get(paneId);
    if (pane) pane.text.content = text;
  }

  updateTerminalGrid(grid: Cell[][]) {
    if (this.focusedPaneId) this.updatePaneGrid(this.focusedPaneId, grid);
  }

  updatePaneGrid(paneId: string, grid: Cell[][]) {
    const pane = this.panes.get(paneId);
    if (!pane) return;
    pane.text.content = this.renderGridToStyledText(grid);
  }

  updateTabState(tabId: string, state: TabState) {
    this.tabStates.set(tabId, state);
    const item = this.tabItems.get(tabId);
    if (!item) return;
    this.updateTabIndicator(tabId, item, state);
    this.updatePaneBorders();
  }

  /** 设置焦点 pane 边框颜色（由动画模块驱动） */
  setViewportBorderColor(color: string) {
    if (this.focusedPaneId) {
      const pane = this.panes.get(this.focusedPaneId);
      if (pane) pane.box.borderColor = color;
    }
  }

  updateStatusBar(text: string) {
    this.statusText.content = text;
  }

  getViewportSize() {
    return {
      cols: this.renderer.terminalWidth - SIDEBAR_WIDTH - 2,
      rows: this.renderer.terminalHeight - 3,
    };
  }

  // ─── 分屏 Pane 管理 ───

  buildPanes(layoutRoot: LayoutNode) {
    const cw = this.paneContainer.width ?? (this.renderer.terminalWidth - SIDEBAR_WIDTH);
    const ch = this.paneContainer.height ?? (this.renderer.terminalHeight - 1);
    const bounds: Rect = { x: 0, y: 0, width: cw, height: ch };
    const rects = resolveRects(layoutRoot, bounds);

    for (const [id, pane] of this.panes) {
      if (!rects.has(id)) {
        this.paneContainer.remove(pane.box.id);
        pane.box.destroy();
        this.panes.delete(id);
      }
    }

    for (const [id, rect] of rects) {
      let pane = this.panes.get(id);
      if (!pane) {
        const box = new BoxRenderable(this.renderer, {
          id: `pane-${id}`,
          position: "absolute",
          left: rect.x,
          top: rect.y,
          width: rect.width,
          height: rect.height,
          border: true,
          borderStyle: "single",
          borderColor: theme.viewport.borderIdle,
          backgroundColor: theme.terminal.bg,
        });
        const text = new TextRenderable(this.renderer, {
          id: `pane-text-${id}`,
          content: "",
          fg: theme.terminal.fg,
        });
        box.add(text);
        this.paneContainer.add(box);
        pane = { box, text };
        this.panes.set(id, pane);
      } else {
        pane.box.left = rect.x;
        pane.box.top = rect.y;
        pane.box.width = rect.width;
        pane.box.height = rect.height;
      }
    }

    this.updatePaneBorders();
  }

  focusPane(paneId: string) {
    this.focusedPaneId = paneId;
    this.updatePaneBorders();
  }

  private updatePaneBorders() {
    for (const [id, pane] of this.panes) {
      const isFocused = id === this.focusedPaneId;
      const state = this.tabStates.get(id);
      const agentStatus = this.agentStatuses.get(id);
      if (agentStatus === "error") {
        pane.box.borderColor = "#ff5555";
      } else if (agentStatus === "busy") {
        pane.box.borderColor = theme.viewport.borderBusy;
      } else if (agentStatus === "success") {
        pane.box.borderColor = "#55ff55";
      } else if (state?.hasAlert) {
        pane.box.borderColor = theme.viewport.borderAttention;
      } else if (state?.isBusy) {
        pane.box.borderColor = theme.viewport.borderBusy;
      } else if (isFocused) {
        pane.box.borderColor = theme.viewport.borderActive;
      } else {
        pane.box.borderColor = theme.viewport.borderIdle;
      }
    }
  }

  getPaneSize(paneId: string): { cols: number; rows: number } {
    const pane = this.panes.get(paneId);
    if (!pane) return { cols: 80, rows: 24 };
    return { cols: (pane.box.width ?? 80) - 2, rows: (pane.box.height ?? 24) - 2 };
  }

  /** 设置活跃 pane 的终端光标位置和样式 */
  setPaneCursor(paneId: string, cursorInfo: CursorInfo): void {
    const pane = this.panes.get(paneId);
    if (!pane) return;

    const paneLeft = typeof pane.box.left === "number" ? pane.box.left : 0;
    const paneTop = typeof pane.box.top === "number" ? pane.box.top : 0;

    // pane 边框占 1 字符，内容区域从 (left+1, top+1) 开始
    const screenX = paneLeft + 1 + cursorInfo.x;
    const screenY = paneTop + 1 + cursorInfo.y;

    this.renderer.setCursorPosition(screenX, screenY, cursorInfo.visible);

    // 映射光标样式：xterm "bar" → OpenTUI "line"
    const styleMap: Record<string, CursorStyleOptions["style"]> = {
      block: "block",
      bar: "line",
      underline: "underline",
      default: "default",
    };
    this.renderer.setCursorStyle({
      style: styleMap[cursorInfo.style] ?? "block",
    });
  }

  /** 隐藏光标（非活跃 pane / 无活跃 pane 时调用） */
  hideCursor(): void {
    this.renderer.setCursorPosition(0, 0, false);
  }

  getVisiblePaneSizes(): Map<string, { cols: number; rows: number }> {
    const result = new Map<string, { cols: number; rows: number }>();
    for (const [id] of this.panes) {
      result.set(id, this.getPaneSize(id));
    }
    return result;
  }

  removePane(paneId: string) {
    const pane = this.panes.get(paneId);
    if (pane) {
      this.paneContainer.remove(pane.box.id);
      pane.box.destroy();
      this.panes.delete(paneId);
    }
  }

  private renderGridToStyledText(grid: Cell[][]): StyledText {
    const chunks: TextChunk[] = [];

    for (let y = 0; y < grid.length; y++) {
      const row = grid[y]!;
      let buf = "";
      let bufFg = "";
      let bufBg = "";
      let bufBold = false;
      let bufUnderline = false;

      const flush = () => {
        if (!buf) return;
        const chunk: TextChunk = { __isChunk: true as const, text: buf };
        if (bufFg) chunk.fg = RGBA.fromHex(bufFg);
        if (bufBg) chunk.bg = RGBA.fromHex(bufBg);
        if (bufBold || bufUnderline) {
          let attr = 0;
          if (bufBold) attr |= TextAttributes.BOLD;
          if (bufUnderline) attr |= TextAttributes.UNDERLINE;
          chunk.attributes = attr;
        }
        chunks.push(chunk);
        buf = "";
      };

      for (let x = 0; x < row.length; x++) {
        const cell = row[x]!;
        if (cell.width === 0) continue;

        const fg = cell.fg === "#ffffff" ? "" : cell.fg;
        const bg = cell.bg === "#000000" ? "" : cell.bg;

        if (fg !== bufFg || bg !== bufBg || cell.bold !== bufBold || cell.underline !== bufUnderline) {
          flush();
          bufFg = fg;
          bufBg = bg;
          bufBold = cell.bold;
          bufUnderline = cell.underline;
        }

        buf += cell.char;
      }
      flush();

      if (y < grid.length - 1) {
        chunks.push({ __isChunk: true as const, text: "\n" });
      }
    }

    return new StyledText(chunks);
  }

  // ─── Overlay: 重命名 Tab ───

  /** 显示重命名输入框，返回 Promise<string | null>（null = 取消） */
  showRenameOverlay(currentName: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.renameResolve = resolve;
      this.renameBuffer = currentName;

      const width = this.renderer.terminalWidth;
      const height = this.renderer.terminalHeight;
      const overlayW = 40;
      const overlayH = 5;
      const left = Math.floor((width - overlayW) / 2);
      const top = Math.floor((height - overlayH) / 2);

      this.renameOverlay = new BoxRenderable(this.renderer, {
        id: "rename-overlay",
        position: "absolute",
        left,
        top,
        width: overlayW,
        height: overlayH,
        border: true,
        borderStyle: "single",
        borderColor: "#00ff88",
        backgroundColor: "#1a1a2e",
        flexDirection: "column",
      });

      const label = new TextRenderable(this.renderer, {
        id: "rename-label",
        content: " 重命名 Tab (Enter确认 / Esc取消)",
        fg: "#888888",
      });

      this.renameInput = new TextRenderable(this.renderer, {
        id: "rename-input",
        content: ` ${this.renameBuffer}\u2588`,
        fg: "#ffffff",
      });

      this.renameOverlay.add(label);
      this.renameOverlay.add(this.renameInput);
      this.renderer.root.add(this.renameOverlay);
    });
  }

  /** 处理重命名模式下的按键，返回 true 表示已消费 */
  handleRenameKey(key: string): boolean {
    if (!this.renameOverlay || !this.renameInput) return false;

    if (key === "\r") {
      // Enter: 确认
      const result = this.renameBuffer;
      this.closeRenameOverlay();
      this.renameResolve?.(result || null);
      return true;
    }

    if (key === "\x1b" || key === "\x03") {
      // Esc / Ctrl+C: 取消
      this.closeRenameOverlay();
      this.renameResolve?.(null);
      return true;
    }

    if (key === "\x7f" || key === "\x08") {
      // Backspace
      this.renameBuffer = this.renameBuffer.slice(0, -1);
      this.renameInput.content = ` ${this.renameBuffer}\u2588`;
      return true;
    }

    // 可打印字符（过滤控制字符和转义序列）
    if (key.length >= 1 && !/^\x1b/.test(key) && key.charCodeAt(0) >= 32) {
      this.renameBuffer += key;
      this.renameInput.content = ` ${this.renameBuffer}\u2588`;
      return true;
    }

    return true; // 重命名模式下拦截所有按键
  }

  private closeRenameOverlay() {
    if (this.renameOverlay) {
      this.renderer.root.remove(this.renameOverlay.id);
      this.renameOverlay.destroy();
      this.renameOverlay = null;
      this.renameInput = null;
      this.renameResolve = null;
    }
  }

  get isRenaming(): boolean {
    return this.renameOverlay !== null;
  }

  // ─── Overlay: 关闭确认 ───

  /** 显示关闭确认弹窗，返回 Promise<boolean> */
  showConfirmOverlay(tabName: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.confirmResolve = resolve;

      const width = this.renderer.terminalWidth;
      const height = this.renderer.terminalHeight;
      const overlayW = 44;
      const overlayH = 5;
      const left = Math.floor((width - overlayW) / 2);
      const top = Math.floor((height - overlayH) / 2);

      this.confirmOverlay = new BoxRenderable(this.renderer, {
        id: "confirm-overlay",
        position: "absolute",
        left,
        top,
        width: overlayW,
        height: overlayH,
        border: true,
        borderStyle: "single",
        borderColor: "#ff4444",
        backgroundColor: "#1a1a2e",
        flexDirection: "column",
      });

      const msg = new TextRenderable(this.renderer, {
        id: "confirm-msg",
        content: ` 关闭 "${tabName}" ?`,
        fg: "#ffaa00",
      });

      const hint = new TextRenderable(this.renderer, {
        id: "confirm-hint",
        content: " Enter: 确认关闭 | Esc: 取消",
        fg: "#888888",
      });

      this.confirmOverlay.add(msg);
      this.confirmOverlay.add(hint);
      this.renderer.root.add(this.confirmOverlay);
    });
  }

  /** 处理确认弹窗下的按键，返回 true 表示已消费 */
  handleConfirmKey(key: string): boolean {
    if (!this.confirmOverlay) return false;

    if (key === "\r" || key === "y" || key === "Y") {
      this.closeConfirmOverlay();
      this.confirmResolve?.(true);
      return true;
    }

    if (key === "\x1b" || key === "\x03" || key === "n" || key === "N") {
      this.closeConfirmOverlay();
      this.confirmResolve?.(false);
      return true;
    }

    return true; // 确认模式下拦截所有按键
  }

  private closeConfirmOverlay() {
    if (this.confirmOverlay) {
      this.renderer.root.remove(this.confirmOverlay.id);
      this.confirmOverlay.destroy();
      this.confirmOverlay = null;
      this.confirmResolve = null;
    }
  }

  get isConfirming(): boolean {
    return this.confirmOverlay !== null;
  }

  // ─── Tab 名称更新 ───

  /** 更新 tab 显示名称（重命名后调用） */
  updateTabName(tabId: string, newName: string) {
    const item = this.tabItems.get(tabId);
    if (!item) return;
    item.name = newName;
    const state = this.tabStates.get(tabId);
    this.updateTabIndicator(tabId, item, state);
  }

  destroy() {
    this.renderer.destroy();
  }
}
