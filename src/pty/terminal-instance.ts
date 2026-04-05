import { spawn } from "bun-pty";
import type { IPty, IPtyForkOptions, IDisposable } from "bun-pty";

export interface TerminalInstanceOptions {
  shell?: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

export class TerminalInstance {
  private pty: IPty;
  private dataListeners: ((data: string) => void)[] = [];
  private exitListeners: ((code: number) => void)[] = [];
  private dataSubscription: IDisposable | null = null;
  private exitSubscription: IDisposable | null = null;

  readonly id: string;
  readonly pid: number;

  constructor(id: string, options: TerminalInstanceOptions = {}) {
    this.id = id;
    const isWin = process.platform === "win32";
    const shell = options.shell ?? (isWin ? "powershell.exe" : "/bin/bash");
    const args = isWin && shell === "powershell.exe" ? ["-NoLogo"] : [];

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      ...options.env,
    };
    // Windows 上强制 UTF-8 代码页
    if (isWin) {
      env.CHCP = "65001";
    }

    const ptyOptions: IPtyForkOptions = {
      name: "xterm-256color",
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: options.cwd ?? process.cwd(),
      env,
    };

    this.pty = spawn(shell, args, ptyOptions);
    this.pid = this.pty.pid;

    this.dataSubscription = this.pty.onData((data) => {
      for (const listener of this.dataListeners) {
        listener(data);
      }
    });

    this.exitSubscription = this.pty.onExit(({ exitCode }) => {
      for (const listener of this.exitListeners) {
        listener(exitCode);
      }
    });
  }

  get cols() { return this.pty.cols; }
  get rows() { return this.pty.rows; }

  onData(listener: (data: string) => void) {
    this.dataListeners.push(listener);
    return () => {
      this.dataListeners = this.dataListeners.filter((l) => l !== listener);
    };
  }

  onExit(listener: (code: number) => void) {
    this.exitListeners.push(listener);
    return () => {
      this.exitListeners = this.exitListeners.filter((l) => l !== listener);
    };
  }

  write(data: string) {
    this.pty.write(data);
  }

  resize(cols: number, rows: number) {
    this.pty.resize(cols, rows);
  }

  kill() {
    this.dataSubscription?.dispose();
    this.exitSubscription?.dispose();
    this.dataListeners = [];
    this.exitListeners = [];
    this.pty.kill();
  }
}
