import { BoxRenderable, TextRenderable } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import { searchCommands, getRecentCommands } from "../db/history.js";
import { theme } from "../theme.js";

interface HistoryEntry {
  id: string;
  command: string;
  cwd: string;
  startedAt: Date | null;
}

export class HistoryOverlay {
  private renderer: CliRenderer;
  private container!: BoxRenderable;
  private searchLine!: TextRenderable;
  private resultsBox!: BoxRenderable;
  private resultTexts: TextRenderable[] = [];
  private query = "";
  private results: HistoryEntry[] = [];
  private selectedIndex = 0;
  private visible = false;

  constructor(renderer: CliRenderer) {
    this.renderer = renderer;
  }

  show() {
    if (this.visible) return;
    this.visible = true;

    const width = this.renderer.terminalWidth;
    const height = this.renderer.terminalHeight;
    const overlayWidth = Math.min(width - 4, 80);
    const overlayHeight = Math.min(Math.floor(height * 0.5), 20);
    const left = Math.floor((width - overlayWidth) / 2);
    const top = Math.floor((height - overlayHeight) / 2);

    this.container = new BoxRenderable(this.renderer, {
      id: "history-overlay",
      position: "absolute",
      left,
      top,
      width: overlayWidth,
      height: overlayHeight,
      border: true,
      borderStyle: "single",
      borderColor: theme.overlay.border,
      backgroundColor: theme.overlay.bg,
      flexDirection: "column",
    });

    // 搜索输入行
    this.searchLine = new TextRenderable(this.renderer, {
      id: "history-search-input",
      content: "> _",
      fg: theme.overlay.fg,
    });
    this.container.add(this.searchLine);

    // 结果区域
    this.resultsBox = new BoxRenderable(this.renderer, {
      id: "history-results",
      flexDirection: "column",
      width: overlayWidth - 2,
    });
    this.container.add(this.resultsBox);

    this.renderer.root.add(this.container);

    // 加载最近命令
    this.refreshResults();
  }

  hide() {
    if (!this.visible) return;
    this.visible = false;
    this.renderer.root.remove(this.container.id);
    this.container.destroy();
    this.resultTexts = [];
  }

  isVisible() {
    return this.visible;
  }

  get currentQuery(): string {
    return this.query;
  }

  /** 追加一个字符到搜索词 */
  appendQuery(ch: string) {
    this.query += ch;
    this.selectedIndex = 0;
    this.updateSearchLine();
    this.refreshResults();
  }

  /** 删除搜索词末尾字符 */
  backspaceQuery() {
    if (this.query.length > 0) {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
      this.updateSearchLine();
      this.refreshResults();
    }
  }

  moveUp() {
    if (this.selectedIndex > 0) {
      this.selectedIndex--;
      this.updateHighlights();
    }
  }

  moveDown() {
    if (this.selectedIndex < this.results.length - 1) {
      this.selectedIndex++;
      this.updateHighlights();
    }
  }

  getSelected(): string | null {
    if (this.results.length === 0) return null;
    return this.results[this.selectedIndex]?.command ?? null;
  }

  private updateSearchLine() {
    this.searchLine.content = `> ${this.query}_`;
  }

  private refreshResults() {
    // 清除旧结果
    for (const t of this.resultTexts) {
      this.resultsBox.remove(t.id);
      t.destroy();
    }
    this.resultTexts = [];

    // 查询
    if (this.query.length > 0) {
      this.results = searchCommands(this.query, 10) as HistoryEntry[];
    } else {
      this.results = getRecentCommands(10) as HistoryEntry[];
    }

    // 渲染结果
    for (let i = 0; i < this.results.length; i++) {
      const entry = this.results[i]!;
      const isSelected = i === this.selectedIndex;

      const timeStr = entry.startedAt
        ? this.formatTime(entry.startedAt)
        : "";

      const content = `${entry.command}  ${timeStr}`;

      const text = new TextRenderable(this.renderer, {
        id: `history-result-${i}`,
        content: isSelected ? `▶ ${content}` : `  ${content}`,
        fg: isSelected ? theme.overlay.selectedFg : theme.overlay.fg,
        width: this.container.width - 2,
        height: 1,
      });

      this.resultsBox.add(text);
      this.resultTexts.push(text);
    }
  }

  private updateHighlights() {
    for (let i = 0; i < this.resultTexts.length; i++) {
      const text = this.resultTexts[i]!;
      const isSelected = i === this.selectedIndex;
      const raw = String(text.content).replace(/^[▶ ]{2}/, "");
      text.content = isSelected ? `▶ ${raw}` : `  ${raw}`;
      text.fg = isSelected ? theme.overlay.selectedFg : theme.overlay.fg;
    }
  }

  private formatTime(date: Date): string {
    const d = new Date(date);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}
