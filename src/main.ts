import { createCliRenderer } from "@opentui/core";
import { TerminalManager } from "./pty/terminal-manager.js";
import { AppUI } from "./tui/app.js";
import { AnsiParser } from "./parser/ansi-parser.js";
import { createAppActor } from "./state/app-machine.js";
import { createTabActor } from "./state/tab-machine.js";
import { RpcServer } from "./rpc/server.js";
import { db } from "./db/connection.js";
import { runMigrations } from "./db/connection.js";
import { tabs } from "./db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  // 1. 初始化数据库
  runMigrations();

  // 2. 创建渲染器
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  // 3. 创建 UI
  const ui = new AppUI(renderer);

  // 4. 创建 PTY 管理器
  const ptyManager = new TerminalManager();

  // 5. 创建状态机
  const appActor = createAppActor();
  appActor.start();

  // 6. 解析器映射（每个 tab 一个）
  const parsers = new Map<string, AnsiParser>();
  const tabActors = new Map<string, ReturnType<typeof createTabActor>>();

  // 7. 创建新 Tab
  function createTab(name: string, cwd?: string, shell?: string) {
    const id = `tab-${Date.now()}`;
    const parser = new AnsiParser(renderer.cols - 22, renderer.rows - 3);
    parsers.set(id, parser);

    const terminal = ptyManager.create(id, { cwd, shell });

    const tabActor = createTabActor(id, name, cwd ?? process.cwd());
    tabActor.start();
    tabActors.set(id, tabActor);

    terminal.onData((data) => {
      parser.feed(data);
      tabActor.send({ type: "DATA_RECEIVED", data });
      const rows = parser.getRows();
      ui.updateTerminalOutput(rows.join("\n"));
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

  // 8. 删除 Tab
  function removeTab(id: string) {
    ptyManager.kill(id);
    parsers.delete(id);
    const actor = tabActors.get(id);
    actor?.stop();
    tabActors.delete(id);
    ui.removeTab(id);
    appActor.send({ type: "REMOVE_TAB", tabId: id });
    db.delete(tabs).where(eq(tabs.id, id)).run();
  }

  // 9. 键盘处理
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
            ui.updateTerminalOutput(parser.getRows().join("\n"));
          }
        }
        return;
      }
    }

    // Ctrl+C 退出
    if (key === "\x03") {
      ptyManager.killAll();
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

  // 10. 订阅状态变化更新 UI
  appActor.subscribe((state) => {
    const { activeTabId } = state.context;
    if (activeTabId) {
      ui.setActiveTab(activeTabId);
    }
  });

  // 11. 启动 RPC 服务
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

  // 12. 恢复上次的 session 或创建默认 Tab
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
