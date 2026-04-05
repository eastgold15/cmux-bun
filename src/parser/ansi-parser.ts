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

  // 通知检测回调
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
        // ANSI escape sequence
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
        // Backspace
        if (this.cursorX > 0) this.cursorX--;
        i++;
      } else {
        // Normal character
        if (this.cursorX < this.cols && this.cursorY < this.rows) {
          this.grid[this.cursorY][this.cursorX] = {
            char: data[i],
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
      }
    }

    // 通知检测：检查最后几行是否包含提示模式
    this.detectNotifyPatterns(data);
  }

  private parseEscape(data: string, start: number): number {
    if (start + 1 >= data.length) return start + 1;

    const next = data[start + 1];

    // CSI 序列: \x1b[
    if (next === "[") {
      return this.parseCsi(data, start + 2);
    }

    // OSC 序列: \x1b]
    if (next === "]") {
      return this.parseOsc(data, start + 2);
    }

    return start + 2;
  }

  private parseCsi(data: string, start: number): number {
    let params = "";
    let i = start;

    while (i < data.length) {
      const ch = data[i];
      if (ch >= "0" && ch <= "9" || ch === ";" || ch === "?") {
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
      if (data[i] === "\x07" || data[i] === "\x1b") {
        return i + 1;
      }
      i++;
    }
    return i;
  }

  private executeCsi(command: string, params: string) {
    const parts = params ? params.split(";").map(Number) : [];

    switch (command) {
      case "H": // Cursor position
      case "f": {
        const row = (parts[0] ?? 1) - 1;
        const col = (parts[1] ?? 1) - 1;
        this.cursorY = Math.max(0, Math.min(row, this.rows - 1));
        this.cursorX = Math.max(0, Math.min(col, this.cols - 1));
        break;
      }
      case "A": // Cursor up
        this.cursorY = Math.max(0, this.cursorY - (parts[0] ?? 1));
        break;
      case "B": // Cursor down
        this.cursorY = Math.min(this.rows - 1, this.cursorY + (parts[0] ?? 1));
        break;
      case "C": // Cursor forward
        this.cursorX = Math.min(this.cols - 1, this.cursorX + (parts[0] ?? 1));
        break;
      case "D": // Cursor back
        this.cursorX = Math.max(0, this.cursorX - (parts[0] ?? 1));
        break;
      case "J": // Erase display
        this.eraseDisplay(parts[0] ?? 0);
        break;
      case "K": // Erase line
        this.eraseLine(parts[0] ?? 0);
        break;
      case "m": // SGR (colors/attributes)
        this.applySgr(parts);
        break;
      default:
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
        // 256-color and truecolor skipped for MVP
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
    if (mode === 2) {
      this.grid = this.createGrid(this.cols, this.rows);
      this.cursorX = 0;
      this.cursorY = 0;
    }
  }

  private eraseLine(mode: number) {
    if (mode === 0) {
      // Cursor to end
      for (let x = this.cursorX; x < this.cols; x++) {
        this.grid[this.cursorY][x] = this.defaultCell();
      }
    } else if (mode === 2) {
      // Entire line
      for (let x = 0; x < this.cols; x++) {
        this.grid[this.cursorY][x] = this.defaultCell();
      }
    }
  }

  private scrollUp() {
    this.grid.shift();
    this.grid.push(Array.from({ length: this.cols }, () => this.defaultCell()));
  }

  private defaultCell(): Cell {
    return {
      char: " ",
      fg: "#ffffff",
      bg: "#000000",
      bold: false,
      underline: false,
    };
  }

  private detectNotifyPatterns(data: string) {
    // 检测 AI Agent 的等待输入模式
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
