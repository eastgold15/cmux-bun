export interface Cell {
  char: string;
  fg: string;
  bg: string;
  bold: boolean;
  underline: boolean;
  width: number; // 1 = narrow, 2 = wide (CJK/emoji)
}

/**
 * 判断 Unicode 码点的显示宽度（简化版 wcwidth）。
 * CJK Unified Ideographs、CJK Compatibility、Fullwidth Forms 等占 2 列。
 * 结合标记（Combining marks, 0x0300–0x036F）占 0 列。
 * 其余默认占 1 列。
 */
function charWidth(cp: number): number {
  // 结合标记
  if (cp >= 0x0300 && cp <= 0x036F) return 0;
  if (cp >= 0x1AB0 && cp <= 0x1AFF) return 0;
  if (cp >= 0x1DC0 && cp <= 0x1DFF) return 0;
  if (cp >= 0x20D0 && cp <= 0x20FF) return 0;
  if (cp >= 0xFE20 && cp <= 0xFE2F) return 0;

  // CJK Unified Ideographs
  if (cp >= 0x4E00 && cp <= 0x9FFF) return 2;
  // CJK Extension A
  if (cp >= 0x3400 && cp <= 0x4DBF) return 2;
  // CJK Extension B & later
  if (cp >= 0x20000 && cp <= 0x2A6DF) return 2;
  // CJK Compatibility Ideographs
  if (cp >= 0xF900 && cp <= 0xFAFF) return 2;
  // CJK Radicals Supplement / Kangxi
  if (cp >= 0x2E80 && cp <= 0x2FDF) return 2;
  // CJK Symbols and Punctuation 中的部分
  if (cp >= 0x3000 && cp <= 0x303F) return 2;
  // Hiragana / Katakana
  if (cp >= 0x3040 && cp <= 0x309F) return 2;
  if (cp >= 0x30A0 && cp <= 0x30FF) return 2;
  // Fullwidth Forms
  if (cp >= 0xFF01 && cp <= 0xFF60) return 2;
  if (cp >= 0xFFE0 && cp <= 0xFFE6) return 2;
  // Hangul Syllables
  if (cp >= 0xAC00 && cp <= 0xD7AF) return 2;
  // Hangul Jamo
  if (cp >= 0x1100 && cp <= 0x11FF) return 2;
  // Box Drawing / Block Elements（部分终端算双宽，保守按 1 处理）

  // Emoji ranges (主要的双宽 emoji)
  if (cp >= 0x1F300 && cp <= 0x1F9FF) return 2;
  if (cp >= 0x1FA00 && cp <= 0x1FAFF) return 2;
  if (cp >= 0x2600 && cp <= 0x27BF) return 2; // Misc Symbols
  if (cp >= 0xFE00 && cp <= 0xFE0F) return 0; // Variation selectors

  return 1;
}

export class AnsiParser {
  private grid: Cell[][];
  private cursorX = 0;
  private cursorY = 0;
  private cols: number;
  private rows: number;

  private currentFg = "#ffffff";
  private currentBg = "#000000";
  private bold = false;
  private underline = false;

  private notifyCallback: (() => void) | null = null;

  constructor(cols = 80, rows = 24) {
    this.cols = cols;
    this.rows = rows;
    this.grid = this.createGrid(cols, rows);
  }

  private createGrid(cols: number, rows: number): Cell[][] {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => this.defaultCell())
    );
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.grid = this.createGrid(cols, rows);
    this.cursorX = 0;
    this.cursorY = 0;
  }

  onNotify(callback: () => void) {
    this.notifyCallback = callback;
  }

  feed(data: string) {
    // 使用 Array.from 按 code point 展开，正确处理 UTF-16 surrogate pairs
    const chars = [...data];
    let idx = 0;

    while (idx < chars.length) {
      const ch = chars[idx]!;

      if (ch === "\x1b") {
        idx = this.parseEscape(chars, idx);
      } else if (ch === "\r") {
        this.cursorX = 0;
        idx++;
      } else if (ch === "\n") {
        this.cursorY++;
        if (this.cursorY >= this.rows) {
          this.scrollUp();
          this.cursorY = this.rows - 1;
        }
        idx++;
      } else if (ch === "\t") {
        this.cursorX = Math.min(this.cursorX + 8 - (this.cursorX % 8), this.cols - 1);
        idx++;
      } else if (ch === "\x08") {
        // Backspace: 回退到前一个非填充位
        if (this.cursorX > 0) {
          this.cursorX--;
          const row = this.grid[this.cursorY];
          if (row && this.cursorX > 0 && row[this.cursorX]?.width === 0) {
            this.cursorX--;
          }
        }
        idx++;
      } else {
        const cp = ch.codePointAt(0)!;
        if (cp >= 32) {
          this.putChar(ch, cp);
        }
        idx++;
      }
    }

    this.detectNotifyPatterns();
  }

  /** 将一个字符写入 grid，处理宽字符的 2-cell 占位 */
  private putChar(ch: string, cp: number) {
    if (this.cursorY >= this.rows || this.cursorX >= this.cols) return;

    const w = charWidth(cp);
    const row = this.grid[this.cursorY]!;

    if (w === 0) {
      // 结合标记：附加到前一个非空 cell
      for (let x = this.cursorX - 1; x >= 0; x--) {
        if (row[x]!.width > 0) {
          row[x]!.char += ch;
          return;
        }
      }
      return;
    }

    // 如果写宽字符但剩余列不足 2 列，先清除当前列然后换行
    if (w === 2 && this.cursorX >= this.cols - 1) {
      row[this.cursorX] = this.defaultCell();
      this.cursorX = 0;
      this.cursorY++;
      if (this.cursorY >= this.rows) {
        this.scrollUp();
        this.cursorY = this.rows - 1;
      }
    }

    const currentRow = this.grid[this.cursorY]!;
    // 写入主 cell
    currentRow[this.cursorX] = {
      char: ch,
      fg: this.currentFg,
      bg: this.currentBg,
      bold: this.bold,
      underline: this.underline,
      width: w,
    };

    if (w === 2) {
      // 宽字符占 2 列：第二个 cell 标记为 width=0（占位）
      if (this.cursorX + 1 < this.cols) {
        currentRow[this.cursorX + 1] = {
          char: "",
          fg: this.currentFg,
          bg: this.currentBg,
          bold: this.bold,
          underline: this.underline,
          width: 0,
        };
      }
    }

    this.cursorX += w;
    if (this.cursorX >= this.cols) {
      this.cursorX = 0;
      this.cursorY++;
      if (this.cursorY >= this.rows) {
        this.scrollUp();
        this.cursorY = this.rows - 1;
      }
    }
  }

  private parseEscape(chars: string[], start: number): number {
    if (start + 1 >= chars.length) return start + 1;

    const next = chars[start + 1];

    // CSI 序列: \x1b[
    if (next === "[") {
      return this.parseCsi(chars, start + 2);
    }

    // OSC 序列: \x1b]  (以 BEL \x07 或 ST \x1b\\ 结尾)
    if (next === "]") {
      return this.parseOsc(chars, start + 2);
    }

    // SS2/SS3: \x1bN / \x1bO — 两字节序列，直接跳过
    if (next === "N" || next === "O") {
      return start + 3;
    }

    // 字符集选择: \x1b( \x1b) \x1b* \x1b+ — 后跟 1 字节
    if (next === "(" || next === ")" || next === "*" || next === "+") {
      return start + 3;
    }

    // DEC private modes: \x1b< \x1b= \x1b> 等单字节
    // 重置/保存/恢复: \x1b7 \x1b8 \x1bc
    // 这些都是两字节序列，直接跳过
    return start + 2;
  }

  private parseCsi(chars: string[], start: number): number {
    let params = "";
    let i = start;

    while (i < chars.length) {
      const ch = chars[i]!;
      // CSI 参数: 数字、分号、问号、空格、引号等
      if (
        (ch >= "0" && ch <= "9") ||
        ch === ";" || ch === "?" || ch === " " ||
        ch === "\"" || ch === "'" || ch === "$" || ch === "#"
      ) {
        params += ch;
        i++;
      } else if (ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) <= 0x2f) {
        // 中间字节范围也跳过
        params += ch;
        i++;
      } else {
        // Final byte
        this.executeCsi(ch, params);
        return i + 1;
      }
    }
    return i;
  }

  private parseOsc(chars: string[], start: number): number {
    let i = start;
    while (i < chars.length) {
      // BEL 结束
      if (chars[i] === "\x07") return i + 1;
      // ST (\x1b\\) 结束
      if (chars[i] === "\x1b" && i + 1 < chars.length && chars[i + 1] === "\\") {
        return i + 2;
      }
      i++;
    }
    return i;
  }

  private cursorVisible = true;

  private executeCsi(command: string, rawParams: string) {
    // 保留私有模式标记 (?)
    const isPrivate = rawParams.startsWith("?");
    const cleaned = rawParams.replace(/[?"' $]/g, "");
    const parts = cleaned.split(";").filter(Boolean).map(Number);

    switch (command) {
      case "H": // Cursor position
      case "f": {
        const row = (parts[0] ?? 1) - 1;
        const col = (parts[1] ?? 1) - 1;
        this.cursorY = Math.max(0, Math.min(row, this.rows - 1));
        this.cursorX = Math.max(0, Math.min(col, this.cols - 1));
        break;
      }
      case "A": this.cursorY = Math.max(0, this.cursorY - (parts[0] ?? 1)); break;
      case "B": this.cursorY = Math.min(this.rows - 1, this.cursorY + (parts[0] ?? 1)); break;
      case "C": this.cursorX = Math.min(this.cols - 1, this.cursorX + (parts[0] ?? 1)); break;
      case "D": this.cursorX = Math.max(0, this.cursorX - (parts[0] ?? 1)); break;
      case "E": // Cursor next line
        this.cursorY = Math.min(this.rows - 1, this.cursorY + (parts[0] ?? 1));
        this.cursorX = 0;
        break;
      case "F": // Cursor previous line
        this.cursorY = Math.max(0, this.cursorY - (parts[0] ?? 1));
        this.cursorX = 0;
        break;
      case "G": // Cursor horizontal absolute
        this.cursorX = Math.max(0, Math.min((parts[0] ?? 1) - 1, this.cols - 1));
        break;
      case "J": this.eraseDisplay(parts[0] ?? 0); break;
      case "K": this.eraseLine(parts[0] ?? 0); break;
      case "L": // Insert lines
        this.insertLines(parts[0] ?? 1);
        break;
      case "M": // Delete lines
        this.deleteLines(parts[0] ?? 1);
        break;
      case "P": // Delete characters
        this.deleteChars(parts[0] ?? 1);
        break;
      case "@": // Insert characters
        this.insertChars(parts[0] ?? 1);
        break;
      case "S": // Scroll up
        for (let n = 0; n < (parts[0] ?? 1); n++) this.scrollUp();
        break;
      case "T": // Scroll down
        for (let n = 0; n < (parts[0] ?? 1); n++) this.scrollDown();
        break;
      case "m": this.applySgr(parts); break;
      case "h": // Set mode
        if (isPrivate) {
          // DECSET: \x1b[?25h = 显示光标, \x1b[?1049h = 切换 alternate screen, etc.
          if (parts[0] === 25) this.cursorVisible = true;
        }
        break;
      case "l": // Reset mode
        if (isPrivate) {
          // DECRST: \x1b[?25l = 隐藏光标, \x1b[?1049l = 恢复 main screen, etc.
          if (parts[0] === 25) this.cursorVisible = false;
        }
        break;
      case "n": // Device Status Report — 忽略，不回写
        break;
      case "c": // Device Attributes — 忽略
        break;
      case "t": // Window manipulation (XTWINOPS) — 忽略（\x1b[4;739;2383t 就是这个）
        break;
      case "r": // Set scrolling region — 暂时忽略
        break;
      case "s": // Save cursor — 忽略
        break;
      case "u": // Restore cursor — 忽略
        break;
      default:
        // 未知 CSI 序列一律忽略，不做任何处理
        break;
    }
  }

  private applySgr(params: number[]) {
    if (params.length === 0) {
      this.resetAttributes();
      return;
    }

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      switch (p) {
        case 0: this.resetAttributes(); break;
        case 1: this.bold = true; break;
        case 4: this.underline = true; break;
        case 22: this.bold = false; break;
        case 24: this.underline = false; break;
        case 30: case 31: case 32: case 33:
        case 34: case 35: case 36: case 37:
          this.currentFg = this.sgrColor(p - 30);
          break;
        case 39: this.currentFg = "#ffffff"; break;
        case 40: case 41: case 42: case 43:
        case 44: case 45: case 46: case 47:
          this.currentBg = this.sgrColor(p - 40);
          break;
        case 49: this.currentBg = "#000000"; break;
        default: break;
      }
    }
  }

  private sgrColor(index: number): string {
    const colors = [
      "#000000", "#cd0000", "#00cd00", "#cdcd00",
      "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
    ];
    return colors[index] ?? "#ffffff";
  }

  private resetAttributes() {
    this.currentFg = "#ffffff";
    this.currentBg = "#000000";
    this.bold = false;
    this.underline = false;
  }

  private eraseDisplay(mode: number) {
    if (mode === 0) {
      // Cursor to end of screen
      for (let x = this.cursorX; x < this.cols; x++) {
        this.grid[this.cursorY]![x] = this.defaultCell();
      }
      for (let y = this.cursorY + 1; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          this.grid[y]![x] = this.defaultCell();
        }
      }
    } else if (mode === 1) {
      // Start of screen to cursor
      for (let y = 0; y < this.cursorY; y++) {
        for (let x = 0; x < this.cols; x++) {
          this.grid[y]![x] = this.defaultCell();
        }
      }
      for (let x = 0; x <= this.cursorX; x++) {
        this.grid[this.cursorY]![x] = this.defaultCell();
      }
    } else if (mode === 2) {
      this.grid = this.createGrid(this.cols, this.rows);
    }
  }

  private eraseLine(mode: number) {
    if (mode === 0) {
      for (let x = this.cursorX; x < this.cols; x++) {
        this.grid[this.cursorY]![x] = this.defaultCell();
      }
    } else if (mode === 1) {
      for (let x = 0; x <= this.cursorX; x++) {
        this.grid[this.cursorY]![x] = this.defaultCell();
      }
    } else if (mode === 2) {
      for (let x = 0; x < this.cols; x++) {
        this.grid[this.cursorY]![x] = this.defaultCell();
      }
    }
  }

  private insertLines(count: number) {
    for (let n = 0; n < count; n++) {
      if (this.cursorY < this.rows) {
        this.grid.splice(this.cursorY, 0, Array.from({ length: this.cols }, () => this.defaultCell()));
        this.grid.pop();
      }
    }
  }

  private deleteLines(count: number) {
    for (let n = 0; n < count; n++) {
      if (this.cursorY < this.rows) {
        this.grid.splice(this.cursorY, 1);
        this.grid.push(Array.from({ length: this.cols }, () => this.defaultCell()));
      }
    }
  }

  private insertChars(count: number) {
    const row = this.grid[this.cursorY]!;
    for (let n = 0; n < count; n++) {
      row.splice(this.cursorX, 0, this.defaultCell());
      row.pop();
    }
  }

  private deleteChars(count: number) {
    const row = this.grid[this.cursorY]!;
    for (let n = 0; n < count; n++) {
      row.splice(this.cursorX, 1);
      row.push(this.defaultCell());
    }
  }

  private scrollUp() {
    this.grid.shift();
    this.grid.push(Array.from({ length: this.cols }, () => this.defaultCell()));
  }

  private scrollDown() {
    this.grid.pop();
    this.grid.unshift(Array.from({ length: this.cols }, () => this.defaultCell()));
  }

  private defaultCell(): Cell {
    return { char: " ", fg: "#ffffff", bg: "#000000", bold: false, underline: false, width: 1 };
  }

  /** 基于解析后的 Grid 内容检测通知模式（避免跨包断裂） */
  private detectNotifyPatterns() {
    const patterns = [
      /\(y\/n\)/i,
      /\?\s*\[Y\/n\]/i,
      /\(yes\/no\)/i,
      /\[Y\/n\]/,
      /press any key/i,
      /continue\?/i,
    ];

    // 扫描最后几行即可，避免全量扫描
    const startRow = Math.max(0, this.cursorY - 5);
    for (let y = startRow; y <= this.cursorY && y < this.rows; y++) {
      const row = this.grid[y];
      if (!row) continue;
      const line = row.map((c) => c.char).join("");
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          this.notifyCallback?.();
          return;
        }
      }
    }
  }

  getGrid(): Cell[][] {
    return this.grid;
  }

  getRows(): string[] {
    return this.grid.map((row) => row.map((c) => c.char).join(""));
  }
}
