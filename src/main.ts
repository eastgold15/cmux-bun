import { createCliRenderer } from "@opentui/core";
import { TerminalManager } from "./pty/terminal-manager.js";
import { AppUI } from "./tui/app.js";
import { AnsiParser } from "./parser/ansi-parser.js";
import { createAppActor } from "./state/app-machine.js";
import { createTabActor } from "./state/tab-machine.js";
import { RpcServer } from "./rpc/server.js";
import { db, runMigrations } from "./db/connection.js";
import { tabs } from "./db/schema.js";
import { eq } from "drizzle-orm";

// ── 渲染节流器 ──
class RenderThrottle {
  private pending = false;
  private rafId: ReturnType<typeof setTimeout> | null = null;
  private readonly interval: number;

  constructor(fps = 30) {
    this.interval = Math.floor(1000 / fps);
  }

  schedule(fn: () => void) {
    if (this.pending) return;
    this.pending = true;
    this.rafId = setTimeout(() => {
      this.pending = false;
      fn();
    }, this.interval);
  }

  immediate(fn: () => void) {
    if (this.rafId !== null) {
      clearTimeout(this.rafId);
      this.pending = false;
    }
    fn();
  }

  dispose() {
    if (this.rafId !== null) clearTimeout(this.rafId);
  }
}

async function main() {
  // 0. 环境检查
  if (process.platform !== "win32") {
    console.warn("警告：目前仅在 Windows ConPTY 下优化，其他平台可能存在兼容性问题");
  }

  // 1. 初始化数据库
  runMigrations();

  // 2. 创建状态机（先于渲染器创建，供后续使用）
  const appActor = createAppActor();
  appActor.start();

  // 3. 创建 PTY 管理器（先创建但还不启动任何 PTY）
  const ptyManager = new TerminalManager();

  // 4. 创建渲染器 —— 完全接管屏幕
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  // 5. 渲染器就绪后，创建 UI
  const ui = new AppUI(renderer);

  // 6. 解析器 & 节流器映射
  const parsers = new Map<string, AnsiParser>();
  const tabActors = new Map<string, ReturnType<typeof createTabActor>>();
  const throttles = new Map<string, RenderThrottle>();

  // 7. Resize 联动
  ui.onResize((cols, rows) => {
    const activeId = appActor.getSnapshot().context.activeTabId;
    if (activeId) {
      ptyManager.resize(activeId, cols, rows);
      parsers.get(activeId)?.resize(cols, rows);
    }
  });

  // 8. 创建新 Tab（此时渲染器已就绪，PTY 启动的数据不会泄漏到控制台）
  function createTab(name: string, cwd?: string, shell?: string) {
    const id = `tab-${Date.now()}`;
    const { cols, rows } = ui.getViewportSize();
    const parser = new AnsiParser(cols, rows);
    parsers.set(id, parser);
    throttles.set(id, new RenderThrottle(30));

    // PTY 在渲染器就绪后才创建
    const terminal = ptyManager.create(id, { cwd, shell, cols, rows });

    const tabActor = createTabActor(id, name, cwd ?? process.cwd());
    tabActor.start();
    tabActors.set(id, tabActor);

    terminal.onData((data) => {
      // 1. 数据喂给解析器（过滤所有控制码，只保留可打印内容）
      parser.feed(data);
      tabActor.send({ type: "DATA_RECEIVED", data });

      // 2. 只更新当前活跃 Tab 的视窗，通过节流避免高频重绘
      const activeId = appActor.getSnapshot().context.activeTabId;
      if (activeId === id) {
        throttles.get(id)!.schedule(() => {
          const cleanRows = parser.getRows();
          ui.updateTerminalOutput(cleanRows.join("\n"));
        });
      } else {
        ui.setTabUnread(id);
      }
    });

    terminal.onExit((code) => {
      tabActor.send({ type: "PROCESS_EXITED", code });
    });

    parser.onNotify(() => {
      tabActor.send({ type: "DETECT_NOTIFY_SIGNAL" });
    });

    ui.addTab(id, name);
    appActor.send({ type: "ADD_TAB", tabId: id });

    db.insert(tabs).values({
      name,
      cwd: cwd ?? process.cwd(),
      shell: shell ?? "cmd.exe",
      order: appActor.getSnapshot().context.tabIds.length,
    }).run();

    return id;
  }

  // 9. 删除 Tab
  function removeTab(id: string) {
    ptyManager.kill(id);
    parsers.delete(id);
    throttles.get(id)?.dispose();
    throttles.delete(id);
    const actor = tabActors.get(id);
    actor?.stop();
    tabActors.delete(id);
    ui.removeTab(id);
    appActor.send({ type: "REMOVE_TAB", tabId: id });
    db.delete(tabs).where(eq(tabs.id, id)).run();
  }

  // 10. 键盘处理
  ui.onKey((key: string) => {
    const state = appActor.getSnapshot();
    const activeId = state.context.activeTabId;

    // Alt+数字切换 Tab
    if (key.startsWith("\x1b") && key.length === 2) {
      const num = key.charCodeAt(1) - 49;
      if (num >= 0 && num < 9) {
        appActor.send({ type: "SWITCH_TAB_INDEX", index: num });
        const newActiveId = appActor.getSnapshot().context.activeTabId;
        if (newActiveId) {
          ui.setActiveTab(newActiveId);
          const parser = parsers.get(newActiveId);
          if (parser) {
            throttles.get(newActiveId)?.immediate(() => {
              const cleanRows = parser.getRows();
              ui.updateTerminalOutput(cleanRows.join("\n"));
            });
          }
        }
        return;
      }
    }

    // Ctrl+C 退出
    if (key === "\x03") {
      ptyManager.killAll();
      for (const t of throttles.values()) t.dispose();
      ui.destroy();
      process.exit(0);
    }

    // 其他按键转发给当前活跃的 PTY
    if (activeId) {
      const terminal = ptyManager.get(activeId);
      terminal?.write(key);
      tabActors.get(activeId)?.send({ type: "USER_INPUT", key });
    }
  });

  // 11. 订阅状态变化更新 UI
  appActor.subscribe((state) => {
    const { activeTabId } = state.context;
    if (activeTabId) {
      ui.setActiveTab(activeTabId);
    }
  });

  // 12. 启动 RPC 服务
  const rpc = new RpcServer();
  rpc.on("create_tab", ({ name, cwd, shell }: { name: string; cwd?: string; shell?: string }) => {
    return createTab(name, cwd, shell);
  });
  rpc.on("focus_tab", ({ tabId }: { tabId: string }) => {
    appActor.send({ type: "SWITCH_TAB", tabId });
    return { ok: true };
  });
  rpc.on("close_tab", ({ tabId }: { tabId: string }) => {
    removeTab(tabId);
    return { ok: true };
  });
  rpc.on("list_tabs", () => {
    return appActor.getSnapshot().context.tabIds;
  });
  rpc.start();

  // 13. 恢复上次的 session 或创建默认 Tab
  const savedTabs = db.select().from(tabs).orderBy(tabs.order).all();
  if (savedTabs.length > 0) {
    for (const tab of savedTabs) {
      createTab(tab.name, tab.cwd ?? undefined, tab.shell ?? undefined);
    }
    const firstId = appActor.getSnapshot().context.tabIds[0];
    if (firstId) ui.setActiveTab(firstId);
  } else {
    createTab("Terminal", process.cwd());
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
