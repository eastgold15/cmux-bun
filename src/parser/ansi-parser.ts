export interface Cell {
  char: string;
  fg: string;
  bg: string;
  bold: boolean;
  underline: boolean;
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
      Array.from({ length: cols }, () => ({
        char: " ",
        fg: "#ffffff",
        bg: "#000000",
        bold: false,
        underline: false,
      }))
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
    let i = 0;
    while (i < data.length) {
      if (data[i] === "\x1b") {
        i = this.parseEscape(data, i);
      } else if (data[i] === "\r") {
        this.cursorX = 0;
        i++;
      } else if (data[i] === "\n") {
        this.cursorY++;
        if (this.cursorY >= this.rows) {
          this.scrollUp();
          this.cursorY = this.rows - 1;
        }
        i++;
      } else if (data[i] === "\t") {
        this.cursorX = Math.min(this.cursorX + 8 - (this.cursorX % 8), this.cols - 1);
        i++;
      } else if (data[i] === "\x08") {
        if (this.cursorX > 0) this.cursorX--;
        i++;
      } else if (data.charCodeAt(i) >= 32) {
        // 可打印字符（跳过其他控制字符）
        const row = this.grid[this.cursorY];
        if (row && this.cursorX < this.cols && this.cursorY < this.rows) {
          row[this.cursorX] = {
            char: data.charAt(i),
            fg: this.currentFg,
            bg: this.currentBg,
            bold: this.bold,
            underline: this.underline,
          };
          this.cursorX++;
          if (this.cursorX >= this.cols) {
            this.cursorX = 0;
            this.cursorY++;
            if (this.cursorY >= this.rows) {
              this.scrollUp();
              this.cursorY = this.rows - 1;
            }
          }
        }
        i++;
      } else {
        // 其他控制字符直接跳过
        i++;
      }
    }

    this.detectNotifyPatterns(data);
  }

  private parseEscape(data: string, start: number): number {
    if (start + 1 >= data.length) return start + 1;

    const next = data[start + 1];

    // CSI 序列: \x1b[
    if (next === "[") {
      return this.parseCsi(data, start + 2);
    }

    // OSC 序列: \x1b]  (以 BEL \x07 或 ST \x1b\\ 结尾)
    if (next === "]") {
      return this.parseOsc(data, start + 2);
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

  private parseCsi(data: string, start: number): number {
    let params = "";
    let i = start;

    while (i < data.length) {
      const ch = data[i]!;
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

  private parseOsc(data: string, start: number): number {
    let i = start;
    while (i < data.length) {
      // BEL 结束
      if (data[i] === "\x07") return i + 1;
      // ST (\x1b\\) 结束
      if (data[i] === "\x1b" && i + 1 < data.length && data[i + 1] === "\\") {
        return i + 2;
      }
      i++;
    }
    return i;
  }

  private executeCsi(command: string, params: string) {
    const parts = params.replace(/[?"' $]/g, "").split(";").filter(Boolean).map(Number);

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
      case "h": // Set mode — 忽略（如 \x1b[?1049h 切换 alternate screen）
        break;
      case "l": // Reset mode — 忽略
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
    return { char: " ", fg: "#ffffff", bg: "#000000", bold: false, underline: false };
  }

  private detectNotifyPatterns(data: string) {
    const patterns = [
      /\(y\/n\)/i,
      /\?\s*\[Y\/n\]/i,
      /\(yes\/no\)/i,
      /\[Y\/n\]/,
      /press any key/i,
      /continue\?/i,
    ];

    for (const pattern of patterns) {
      if (pattern.test(data)) {
        this.notifyCallback?.();
        return;
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
