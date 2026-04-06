import { spawn } from "bun-pty";

export class TerminalManager {
  private instances = new Map<string, any>();

  create(id: string, cwd: string, shell: string = "cmd.exe") {
    const pty = spawn(shell, [], {
      name: "xterm-256color",
      cwd,
      cols: 80,
      rows: 24,
    });
    this.instances.set(id, pty);
    return pty;
  }

  write(id: string, data: string) {
    this.instances.get(id)?.write(data);
  }
}