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

async function main() {
  // 0. 环境检查
  if (process.platform !== "win32") {
    console.warn("警告：目前仅在 Windows ConPTY 下优化，其他平台可能存在兼容性问题");
  }

  // 1. 初始化数据库
  runMigrations();

  // 2. 创建状态机
  const appActor = createAppActor();
  appActor.start();

  // 3. 先启动渲染器 —— 完全接管终端（alternate screen + raw mode）
  //    必须在 PTY 之前，否则 PTY 初始化输出会泄漏到物理终端
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  // 4. 渲染器就绪，创建 UI
  const ui = new AppUI(renderer);

  // 5. 数据结构
  const ptyManager = new TerminalManager();
  const parsers = new Map<string, AnsiParser>();
  const tabActors = new Map<string, ReturnType<typeof createTabActor>>();
  // 脏标记：哪些 tab 的 parser 有新数据需要渲染
  const dirtyTabs = new Set<string>();

  // 6. Resize 联动
  ui.onResize((cols, rows) => {
    const activeId = appActor.getSnapshot().context.activeTabId;
    if (activeId) {
      ptyManager.resize(activeId, cols, rows);
      parsers.get(activeId)?.resize(cols, rows);
    }
  });

  // 7. 渲染循环：固定 ~30fps 检查脏标记，只重绘有变化的 tab
  //    不再在 onData 里直接触发 ui.update，避免高频重绘导致 CPU 飙升
  const renderLoop = setInterval(() => {
    const activeId = appActor.getSnapshot().context.activeTabId;
    if (activeId && dirtyTabs.has(activeId)) {
      const parser = parsers.get(activeId);
      if (parser) {
        ui.updateTerminalGrid(parser.getGrid());
      }
      dirtyTabs.delete(activeId);
    }
  }, 32);

  // 8. 创建 Tab（此时渲染器已完全接管终端）
  function createTab(name: string, cwd?: string, shell?: string) {
    const id = `tab-${Date.now()}`;
    const { cols, rows } = ui.getViewportSize();
    const parser = new AnsiParser(cols, rows);
    parsers.set(id, parser);

    const terminal = ptyManager.create(id, { cwd, shell, cols, rows });

    const tabActor = createTabActor(id, name, cwd ?? process.cwd());
    tabActor.start();
    tabActors.set(id, tabActor);

    terminal.onData((data) => {
      // 只喂解析器 + 标记脏，绝对不在这里调 ui.update
      parser.feed(data);
      tabActor.send({ type: "DATA_RECEIVED", data });
      dirtyTabs.add(id);

      // 后台 tab 标记未读
      const activeId = appActor.getSnapshot().context.activeTabId;
      if (activeId !== id) {
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
    dirtyTabs.delete(id);
    const actor = tabActors.get(id);
    actor?.stop();
    tabActors.delete(id);
    ui.removeTab(id);
    appActor.send({ type: "REMOVE_TAB", tabId: id });
    db.delete(tabs).where(eq(tabs.id, id)).run();
  }

  // 10. 键盘处理（通过 OpenTUI 的事件系统，不直接操作 process.stdin）
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
          // Tab 切换时立即渲染一次，不等渲染循环
          const parser = parsers.get(newActiveId);
          if (parser) {
            ui.updateTerminalGrid(parser.getGrid());
          }
        }
        return;
      }
    }

    // Ctrl+C 退出
    if (key === "\x03") {
      clearInterval(renderLoop);
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

  // 11. 订阅状态变化
  appActor.subscribe((state) => {
    const { activeTabId } = state.context;
    if (activeTabId) {
      ui.setActiveTab(activeTabId);
    }
  });

  // 12. RPC
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

  // 13. 恢复 session 或创建默认 Tab
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
