import {
  BoxRenderable,
  TextRenderable,
} from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import type { TabState } from "../types/index.js";
import type { Cell } from "../parser/ansi-parser.js";

const SIDEBAR_WIDTH = 22;

export class AppUI {
  private renderer: CliRenderer;
  private sidebar!: BoxRenderable;
  private viewport!: BoxRenderable;
  private statusBar!: BoxRenderable;
  private statusText!: TextRenderable;
  private tabItems: Map<string, { box: BoxRenderable; text: TextRenderable; cwdText: TextRenderable; hasUnread: boolean }> = new Map();
  private terminalOutput!: TextRenderable;

  private activeTabId: string | null = null;
  private tabStates: Map<string, TabState> = new Map();

  private onKeyHandler: ((key: string) => void) | null = null;
  private onResizeHandler: ((cols: number, rows: number) => void) | null = null;

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
      borderColor: "#444444",
      backgroundColor: "#1a1a2e",
      flexDirection: "column",
    });

    const title = new TextRenderable(this.renderer, {
      id: "sidebar-title",
      content: " cmux-bun",
      fg: "#00ff88",
    });
    this.sidebar.add(title);

    // 主视窗：自适应填满剩余空间
    this.viewport = new BoxRenderable(this.renderer, {
      id: "viewport",
      position: "absolute",
      left: SIDEBAR_WIDTH,
      top: 0,
      width: width - SIDEBAR_WIDTH,
      height: height - 1,
      border: true,
      borderStyle: "single",
      borderColor: "#333333",
      backgroundColor: "#000000",
    });

    this.terminalOutput = new TextRenderable(this.renderer, {
      id: "terminal-output",
      content: "欢迎使用 cmux-bun",
      fg: "#888888",
    });
    this.viewport.add(this.terminalOutput);

    // 状态栏：底部一行
    this.statusBar = new BoxRenderable(this.renderer, {
      id: "status-bar",
      position: "absolute",
      left: 0,
      bottom: 0,
      width,
      height: 1,
      backgroundColor: "#1a1a2e",
      flexDirection: "row",
    });

    this.statusText = new TextRenderable(this.renderer, {
      id: "status-text",
      content: " Alt+1-9: 切换Tab | Ctrl+C: 退出",
      fg: "#888888",
    });
    this.statusBar.add(this.statusText);

    root.add(this.sidebar);
    root.add(this.viewport);
    root.add(this.statusBar);

    // 键盘监听（通过 OpenTUI 事件系统）
    this.renderer.on("key", (key: string) => {
      this.onKeyHandler?.(key);
    });

    // 窗口大小变化
    this.renderer.on("resize", ({ width, height }: { width: number; height: number }) => {
      this.sidebar.height = height - 1;
      this.viewport.width = width - SIDEBAR_WIDTH;
      this.viewport.height = height - 1;
      this.statusBar.width = width;

      const ptyCols = width - SIDEBAR_WIDTH - 2;
      const ptyRows = height - 3;
      this.onResizeHandler?.(ptyCols, ptyRows);
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
      backgroundColor: "#1a1a2e",
      flexDirection: "column",
    });

    const tabText = new TextRenderable(this.renderer, {
      id: `tab-text-${tabId}`,
      content: ` ${name}`,
      fg: "#888888",
    });

    const cwdText = new TextRenderable(this.renderer, {
      id: `tab-cwd-${tabId}`,
      content: cwd ? ` ${this.shortenCwd(cwd)}` : "",
      fg: "#555555",
    });

    tabItem.add(tabText);
    tabItem.add(cwdText);
    this.sidebar.add(tabItem);
    this.tabItems.set(tabId, { box: tabItem, text: tabText, cwdText, hasUnread: false });
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
  }

  setActiveTab(tabId: string) {
    const prevItem = this.activeTabId ? this.tabItems.get(this.activeTabId) : null;
    if (prevItem) {
      prevItem.box.backgroundColor = "#1a1a2e";
      prevItem.text.fg = "#888888";
    }

    this.activeTabId = tabId;
    const current = this.tabItems.get(tabId);
    if (current) {
      current.hasUnread = false;
      const state = this.tabStates.get(tabId);
      const borderColor = state?.hasAlert ? "#ffaa00" : state?.isBusy ? "#4488ff" : "#00ff88";
      current.box.backgroundColor = "#2a2a4e";
      current.text.fg = borderColor;
      this.updateTabIndicator(tabId, current, state);
    }

    this.updateViewportBorder();
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
      item.text.fg = "#ff4444";
    } else if (state?.isBusy) {
      indicator = "*";
      item.text.fg = "#4488ff";
    } else if (item.hasUnread) {
      indicator = "\u25CF";
      item.text.fg = "#ffaa00";
    } else if (isActive) {
      item.text.fg = "#00ff88";
    } else {
      item.text.fg = "#888888";
    }

    const currentContent = item.text.content as unknown as string;
    const name = currentContent.replace(/^.\s/, "");
    item.text.content = `${indicator} ${name}`;
  }

  updateTerminalOutput(text: string) {
    this.terminalOutput.content = text;
  }

  /** 接收 Grid Buffer 渲染为带 ANSI 颜色的字符串 */
  updateTerminalGrid(grid: Cell[][]) {
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

        if (cell.fg !== prevFg || cell.bg !== prevBg || cell.bold !== prevBold || cell.underline !== prevUnderline) {
          if (prevFg !== "" || prevBg !== "" || prevBold || prevUnderline) {
            line += RESET;
          }
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

      if (prevFg !== "" || prevBg !== "" || prevBold || prevUnderline) {
        line += RESET;
      }

      lines.push(line);
    }

    this.terminalOutput.content = lines.join("\n");
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

    if (tabId === this.activeTabId) {
      this.updateViewportBorder();
    }
  }

  private updateViewportBorder() {
    const state = this.activeTabId ? this.tabStates.get(this.activeTabId) : undefined;
    if (state?.hasAlert) {
      this.viewport.borderColor = "#ffaa00";
    } else if (state?.isBusy) {
      this.viewport.borderColor = "#4488ff";
    } else {
      this.viewport.borderColor = "#333333";
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

  destroy() {
    this.renderer.destroy();
  }
}
