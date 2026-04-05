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
import { getGitBranch } from "./utils/git.js";
import { getAnimatedBorderColor } from "./tui/animation.js";
import type { AnimationState } from "./tui/animation.js";

async function main() {
  // 0. 平台检查
  if (process.platform !== "win32") {
    process.stderr.write("[cmux-bun] 警告：目前仅在 Windows ConPTY 下优化，其他平台可能存在兼容性问题\n");
  }

  // 1. 初始化数据库
  runMigrations();

  // 2. 创建状态机
  const appActor = createAppActor();
  appActor.start();

  // 3. 启动渲染器 —— 完全接管终端（alternate screen + raw mode）
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
  });

  // 4. 创建 UI
  const ui = new AppUI(renderer);

  // 4.5 等待 Yoga Layout 完成首帧计算，确保 getViewportSize() 返回正确值
  //     否则 PTY 可能拿到 0x0 或默认 80x24，导致输出错位
  await Bun.sleep(100);

  // 4.6 Ctrl+C 兜底：OpenTUI 的 key 事件可能不传递 \x03
  //     直接监听 stdin 的 raw data 确保能退出
  function gracefulExit() {
    clearInterval(renderLoop);
    ptyManager.killAll();
    ui.destroy();
    process.exit(0);
  }
  process.stdin.on("data", (chunk: Buffer) => {
    if (chunk.includes(0x03)) gracefulExit(); // Ctrl+C
  });

  // 5. 数据结构
  const ptyManager = new TerminalManager();
  const parsers = new Map<string, AnsiParser>();
  const tabActors = new Map<string, ReturnType<typeof createTabActor>>();
  const dirtyTabs = new Set<string>();

  // 6. Resize 联动
  ui.onResize((cols, rows) => {
    const activeId = appActor.getSnapshot().context.activeTabId;
    if (activeId) {
      ptyManager.resize(activeId, cols, rows);
      parsers.get(activeId)?.resize(cols, rows);
    }
  });

  // 7. 渲染循环 ~30fps
  const renderLoop = setInterval(() => {
    const activeId = appActor.getSnapshot().context.activeTabId;

    // 呼吸灯动画：根据 tab 状态驱动视窗边框颜色
    if (activeId) {
      const actor = tabActors.get(activeId);
      if (actor) {
        const tabState = actor.getSnapshot().value as AnimationState;
        ui.setViewportBorderColor(getAnimatedBorderColor(tabState));
      }
    }

    // 终端内容更新
    if (activeId && dirtyTabs.has(activeId)) {
      const parser = parsers.get(activeId);
      if (parser) {
        ui.updateTerminalGrid(parser.getGrid());
      }
      dirtyTabs.delete(activeId);
    }
  }, 32);

  // 8. 创建 Tab
  //    existingId: 从数据库恢复时使用数据库中的 ID，保证内存 ID 与 DB ID 一致
  //    只有新建 Tab 才写入数据库
  function createTab(name: string, cwd?: string, shell?: string, existingId?: string) {
    const id = existingId ?? `tab-${Date.now()}`;
    const { cols, rows } = ui.getViewportSize();
    const parser = new AnsiParser(cols, rows);
    parsers.set(id, parser);

    const terminal = ptyManager.create(id, { cwd, shell, cols, rows });

    const tabActor = createTabActor(id, name, cwd ?? process.cwd());
    tabActor.start();
    tabActors.set(id, tabActor);

    terminal.onData((data) => {
      // 只喂解析器 + 标记脏
      parser.feed(data);
      tabActor.send({ type: "DATA_RECEIVED", data });
      dirtyTabs.add(id);

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

    // 只有新建 Tab 才写入数据库（恢复 session 时用 existingId 跳过）
    if (!existingId) {
      db.insert(tabs).values({
        id,
        name,
        cwd: cwd ?? process.cwd(),
        shell: shell ?? "cmd.exe",
        order: appActor.getSnapshot().context.tabIds.length,
      }).run();
    }

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
            ui.updateTerminalGrid(parser.getGrid());
          }
        }
        return;
      }
    }

    // Ctrl+C 退出（兜底在 stdin data 监听里）
    if (key === "\x03") {
      gracefulExit();
    }

    // 转发给当前 PTY
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

  // 13. 恢复 session：用数据库中的 id 作为 existingId，保证 ID 一致
  const savedTabs = db.select().from(tabs).orderBy(tabs.order).all();
  if (savedTabs.length > 0) {
    for (const tab of savedTabs) {
      createTab(tab.name, tab.cwd ?? undefined, tab.shell ?? undefined, tab.id);
    }
    const firstId = appActor.getSnapshot().context.tabIds[0];
    if (firstId) ui.setActiveTab(firstId);
  } else {
    createTab("Terminal", process.cwd());
  }
}

main().catch((err) => {
  // 写入日志文件，因为 alternate screen 下 console.error 会被刷掉
  const fs = require("node:fs");
  const path = require("node:path");
  const logFile = path.join(require("node:os").tmpdir(), "cmux-crash.log");
  const msg = `[${new Date().toISOString()}] ${err?.stack ?? err}\n`;
  
  try { fs.appendFileSync(logFile, msg); } catch {}
  // 如果终端还没被 OpenTUI 接管，至少在 stderr 留下痕迹
  process.stderr.write(msg);
  process.exit(1);
});
