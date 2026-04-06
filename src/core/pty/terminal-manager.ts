import { TerminalInstance, type TerminalInstanceOptions } from "./terminal-instance";

export class TerminalManager {
  private instances = new Map<string, TerminalInstance>();

  create(id: string, options?: TerminalInstanceOptions): TerminalInstance {
    if (this.instances.has(id)) {
      throw new Error(`Terminal instance ${id} already exists`);
    }
    const instance = new TerminalInstance(id, options);
    this.instances.set(id, instance);

    instance.onExit(() => {
      this.instances.delete(id);
    });

    return instance;
  }

  get(id: string): TerminalInstance | undefined {
    return this.instances.get(id);
  }

  kill(id: string) {
    const instance = this.instances.get(id);
    if (instance) {
      instance.kill();
      this.instances.delete(id);
    }
  }

  killAll() {
    for (const instance of this.instances.values()) {
      instance.kill();
    }
    this.instances.clear();
  }

  list(): TerminalInstance[] {
    return [...this.instances.values()];
  }

  resize(id: string, cols: number, rows: number) {
    const instance = this.instances.get(id);
    instance?.resize(cols, rows);
  }
}
