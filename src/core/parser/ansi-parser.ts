import { Terminal } from "@xterm/headless";
import type { IBufferCell } from "@xterm/headless";

export interface Cell {
  char: string;
  fg: string;
  bg: string;
  bold: boolean;
  underline: boolean;
  width: number; // 0 = 占位(wide char 第二格), 1 = 窄, 2 = 宽(CJK/emoji)
}

export interface CursorInfo {
  x: number;       // 列号（0-based）
  y: number;       // 行号（0-based，clamp 到可见范围）
  style: "block" | "underline" | "bar" | "default";
  visible: boolean;
}

/** xterm.js 256 色调色板（标准终端色） */
const PALETTE_256 = build256Palette();

function build256Palette(): string[] {
  const palette: string[] = [];
  // 0-7: 基础色
  const base = [
    "#000000", "#cd0000", "#00cd00", "#cdcd00",
    "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
  ];
  // 8-15: 高亮色
  const bright = [
    "#7f7f7f", "#ff0000", "#00ff00", "#ffff00",
    "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
  ];
  palette.push(...base, ...bright);
  // 16-231: 6x6x6 色块
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette.push(
          `#${hex(levels[r]!)}${hex(levels[g]!)}${hex(levels[b]!)}`
        );
      }
    }
  }
  // 232-255: 24 级灰阶
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    palette.push(`#${hex(v)}${hex(v)}${hex(v)}`);
  }
  return palette;
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

export class AnsiParser {
  private term: Terminal;
  private notifyCallback: (() => void) | null = null;
  private generation = 0;

  constructor(cols = 80, rows = 24) {
    this.term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  }

  resize(cols: number, rows: number) {
    this.term.resize(cols, rows);
    this.generation++;
  }

  onNotify(callback: () => void) {
    this.notifyCallback = callback;
  }

  feed(data: string) {
    this.term.write(data);
    this.generation++;
    this.detectNotifyPatterns();
  }

  getGeneration(): number {
    return this.generation;
  }

  /** 将 xterm 内部 buffer 转为 Cell[][] 供 UI 层渲染 */
  getGrid(): Cell[][] {
    const buf = this.term.buffer.active;
    const cols = this.term.cols;
    const rows = this.term.rows;
    const result: Cell[][] = [];

    for (let y = 0; y < rows; y++) {
      const line = buf.getLine(y);
      const row: Cell[] = [];

      if (!line) {
        for (let x = 0; x < cols; x++) row.push(this.defaultCell());
        result.push(row);
        continue;
      }

      for (let x = 0; x < cols; x++) {
        const cell = line.getCell(x);
        if (!cell) {
          row.push(this.defaultCell());
          continue;
        }

        const width = cell.getWidth();
        // width=0 表示这是 wide char 的第二格占位
        const ch = width === 0 ? "" : (cell.getChars() || " ");

        row.push({
          char: ch,
          fg: this.resolveColor(cell, true),
          bg: this.resolveColor(cell, false),
          bold: cell.isBold() === 1,
          underline: cell.isUnderline() === 1,
          width,
        });
      }
      result.push(row);
    }

    return result;
  }

  getRows(): string[] {
    const buf = this.term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < this.term.rows; y++) {
      const line = buf.getLine(y);
      rows.push(line ? line.translateToString(true) : "");
    }
    return rows;
  }

  private resolveColor(cell: IBufferCell, isFg: boolean): string {
    const isDefault = isFg ? cell.isFgDefault() : cell.isBgDefault();
    const isRgb = isFg ? cell.isFgRGB() : cell.isBgRGB();
    const isPalette = isFg ? cell.isFgPalette() : cell.isBgPalette();
    const colorValue = isFg ? cell.getFgColor() : cell.getBgColor();

    if (isDefault) return isFg ? "#ffffff" : "#000000";
    if (isRgb) {
      const r = (colorValue >> 16) & 0xff;
      const g = (colorValue >> 8) & 0xff;
      const b = colorValue & 0xff;
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    }
    if (isPalette) {
      return PALETTE_256[colorValue] ?? (isFg ? "#ffffff" : "#000000");
    }
    return isFg ? "#ffffff" : "#000000";
  }

  /** 基于解析后 Buffer 内容检测通知模式（避免跨包断裂） */
  private detectNotifyPatterns() {
    const patterns = [
      /\(y\/n\)/i,
      /\?\s*\[Y\/n\]/i,
      /\(yes\/no\)/i,
      /\[Y\/n\]/,
      /press any key/i,
      /continue\?/i,
    ];

    const buf = this.term.buffer.active;
    const cursorY = buf.cursorY;
    const startRow = Math.max(0, cursorY - 5);

    for (let y = startRow; y <= cursorY && y < this.term.rows; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          this.notifyCallback?.();
          return;
        }
      }
    }
  }

  private defaultCell(): Cell {
    return { char: " ", fg: "#ffffff", bg: "#000000", bold: false, underline: false, width: 1 };
  }

  /** 从 xterm buffer 提取当前光标位置和样式 */
  getCursorInfo(): CursorInfo {
    const buf = this.term.buffer.active;
    const cursorX = Math.min(buf.cursorX, this.term.cols - 1);
    const cursorY = Math.max(0, Math.min(buf.cursorY, this.term.rows - 1));

    // cursorStyle: 0=block, 1=underline, 2=bar (xterm default is block)
    const rawStyle = (this.term as any).options?.cursorStyle ?? "block";
    const styleMap: Record<string, CursorInfo["style"]> = {
      block: "block",
      underline: "underline",
      bar: "bar",
    };

    return {
      x: cursorX,
      y: cursorY,
      style: styleMap[rawStyle] ?? "block",
      visible: true,
    };
  }
}
