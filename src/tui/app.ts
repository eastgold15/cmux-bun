import {
  BoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import type { TabState } from "../types/index.js";
import type { Cell } from "../parser/ansi-parser.js";
import type { LayoutNode, Rect } from "../layout/layout-tree.js";
import { resolveRects } from "../layout/layout-tree.js";
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
  private tabItems: Map<string, { box: BoxRenderable; text: TextRenderable; cwdText: TextRenderable; branchText: TextRenderable; hasUnread: boolean }> = new Map();
  private panes: Map<string, PaneUI> = new Map();

  private activeTabId: string | null = null;
  private focusedPaneId: string | null = null;
  private tabStates: Map<string, TabState> = new Map();

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

    // 键盘监听（通过 OpenTUI 事件系统）
    this.renderer.on("key", (key: string) => {
      this.onKeyHandler?.(key);
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
    this.tabItems.set(tabId, { box: tabItem, text: tabText, cwdText, branchText, hasUnread: false });
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
    this.removePane(tabId);
  }

  setActiveTab(tabId: string) {
    const prevItem = this.activeTabId ? this.tabItems.get(this.activeTabId) : null;
    if (prevItem) {
      prevItem.box.backgroundColor = theme.sidebar.bg;
      prevItem.text.fg = theme.sidebar.tabInactiveFg;
    }

    this.activeTabId = tabId;
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

  private updateTabIndicator(tabId: string, item: { text: TextRenderable; hasUnread: boolean }, state?: TabState) {
    const isActive = tabId === this.activeTabId;
    let indicator = " ";
    if (state?.hasAlert) {
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

    // 从 StyledText 的 chunks 中提取纯文本
    const styled = item.text.content;
    const raw = "chunks" in styled
      ? (styled as { chunks: { text: string }[] }).chunks.map((c) => c.text).join("")
      : String(styled);
    const name = raw.replace(/^.\s/, "");
    item.text.content = `${indicator} ${name}`;
  }

  /** 更新 sidebar tab 的 git 分支显示 */
  updateTabBranch(tabId: string, branch: string | null) {
    const item = this.tabItems.get(tabId);
    if (!item) return;
    item.branchText.content = branch ? ` \uE0A0 ${branch}` : "";
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
    pane.text.content = this.renderGridToAnsi(grid);
  }

  private hexToRgb(hex: string): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `${r};${g};${b}`;
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
      if (state?.hasAlert) {
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

  private renderGridToAnsi(grid: Cell[][]): string {
    const lines: string[] = [];
    const RESET = "\x1b[0m";

    for (let y = 0; y < grid.length; y++) {
      const row = grid[y]!;
      let line = "";
      let prevFg = "";
      let prevBg = "";
      let prevBold = false;
      let prevUnderline = false;

      for (let x = 0; x < row.length; x++) {
        const cell = row[x]!;
        if (cell.width === 0) continue;

        if (cell.fg !== prevFg || cell.bg !== prevBg || cell.bold !== prevBold || cell.underline !== prevUnderline) {
          if (prevFg !== "" || prevBg !== "" || prevBold || prevUnderline) line += RESET;
          if (cell.bold) line += "\x1b[1m";
          if (cell.underline) line += "\x1b[4m";
          if (cell.fg !== "#ffffff") line += `\x1b[38;2;${this.hexToRgb(cell.fg)}m`;
          if (cell.bg !== "#000000") line += `\x1b[48;2;${this.hexToRgb(cell.bg)}m`;
          prevFg = cell.fg;
          prevBg = cell.bg;
          prevBold = cell.bold;
          prevUnderline = cell.underline;
        }

        line += cell.char;
      }

      if (prevFg !== "" || prevBg !== "" || prevBold || prevUnderline) line += RESET;
      lines.push(line);
    }

    return lines.join("\n");
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
    if (key.length === 1 && key.charCodeAt(0) >= 32) {
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
    const state = this.tabStates.get(tabId);
    this.updateTabIndicator(tabId, { text: item.text, hasUnread: item.hasUnread }, state);
    // 强制覆盖 indicator 中的名称部分
    const indicator = String(item.text.content).charAt(0);
    item.text.content = `${indicator} ${newName}`;
  }

  destroy() {
    this.renderer.destroy();
  }
}
