import { createCliRenderer } from "@opentui/core";
import { TerminalManager } from "./core/pty/terminal-manager.js";
import { AppUI } from "./ui/app.js";
import { createAppActor } from "./state/app-machine.js";
import { RpcBridge, McpHost, type AgentContext } from "./agents/index.js";
import { db, runMigrations } from "./db/connection.js";
import { tabs } from "./db/schema.js";
import { getGitBranch } from "./utils/git.js";
import { isWorktree as checkIsWorktree } from "./utils/worktree.js";
import { getAnimatedBorderColor } from "./ui/animation.js";
import type { AnimationState } from "./ui/animation.js";
import { CommandTracker } from "./core/command-tracker.js";
import { TabManager } from "./core/tab-manager.js";
import { KeyHandler } from "./core/key-handler.js";

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

  // 3. 启动渲染器
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    useMouse: true,
  });

  // 4. 创建 UI
  const ui = new AppUI(renderer);

  // 4.5 等待 Yoga Layout 完成首帧计算
  await Bun.sleep(100);

  // 5. 创建核心服务
  const ptyManager = new TerminalManager();
  const cmdTracker = new CommandTracker();
  const tabManager = new TabManager({ appActor, ui, ptyManager, cmdTracker });

  let renderLoop: ReturnType<typeof setInterval>;
  let gitPoll: ReturnType<typeof setInterval>;

  // 4.6 Ctrl+C 兜底
  function gracefulExit() {
    clearInterval(renderLoop);
    clearInterval(gitPoll);
    tabManager.killAll();
    ui.destroy();
    process.exit(0);
  }
  process.stdin.on("data", (chunk: Buffer) => {
    if (chunk.includes(0x03)) gracefulExit();
  });

  // 6. Resize 联动
  ui.onResize(() => {
    if (tabManager.getLayoutRoot()) {
      tabManager.rebuildPanes();
    } else {
      tabManager.resizeActive();
    }
  });

  // 7. 渲染循环 ~30fps
  renderLoop = setInterval(() => {
    const state = appActor.getSnapshot();
    const activeId = state.context.activeTabId;

    // 呼吸灯动画
    if (activeId) {
      const actor = tabManager.getTabActor(activeId);
      if (actor) {
        const tabState = actor.getSnapshot().value as AnimationState;
        ui.setViewportBorderColor(getAnimatedBorderColor(tabState));
      }
    }

    // 终端内容更新
    if (tabManager.getLayoutRoot()) {
      const leaves = tabManager.getVisibleLeaves();
      for (const tabId of leaves) {
        if (tabManager.isDirty(tabId) && tabManager.needsRender(tabId)) {
          const parser = tabManager.getParser(tabId);
          if (parser) {
            ui.updatePaneGrid(tabId, parser.getGrid());
          }
          tabManager.clearDirty(tabId);
        } else if (tabManager.isDirty(tabId)) {
          tabManager.clearDirty(tabId);
        }
      }
    } else if (activeId && tabManager.isDirty(activeId)) {
      if (tabManager.needsRender(activeId)) {
        const parser = tabManager.getParser(activeId);
        if (parser) {
          ui.updateTerminalGrid(parser.getGrid());
        }
      }
      tabManager.clearDirty(activeId);
    }

    // 终端光标渲染：仅活跃 pane 显示光标
    if (activeId) {
      const parser = tabManager.getParser(activeId);
      if (parser) {
        ui.setPaneCursor(activeId, parser.getCursorInfo());
      }
    } else {
      ui.hideCursor();
    }
  }, 32);

  // 7.5 Git 分支轮询（每 5 秒）
  gitPoll = setInterval(() => tabManager.refreshGitBranches(), 5000);

  // 10. 键盘处理
  const keyHandler = new KeyHandler({
    appActor, ui, ptyManager, cmdTracker, tabManager, renderer, gracefulExit,
  });
  ui.onKey((key: string) => keyHandler.handle(key));

  // 10.5 鼠标点击回调
  ui.onTabClick((tabId: string) => {
    appActor.send({ type: "SWITCH_TAB", tabId });
    ui.setActiveTab(tabId);
    const parser = tabManager.getParser(tabId);
    if (parser) ui.updateTerminalGrid(parser.getGrid());
    const cwd = tabManager.getTabCwd(tabId);
    if (cwd) ui.updateTabBranch(tabId, getGitBranch(cwd));
  });

  ui.onPaneClick((paneId: string) => {
    appActor.send({ type: "SWITCH_TAB", tabId: paneId });
    ui.focusPane(paneId);
    ui.setActiveTab(paneId);
    const parser = tabManager.getParser(paneId);
    if (parser) ui.updatePaneGrid(paneId, parser.getGrid());
  });

  // 11. 订阅状态变化
  appActor.subscribe((state) => {
    const { activeTabId } = state.context;
    if (activeTabId) {
      ui.setActiveTab(activeTabId);
    }
  });

  // 12. Agents (RPC Bridge + MCP Host)
  const agentCtx: AgentContext = {
    getActiveTabId: () => tabManager.getActiveTabId(),
    getTabIds: () => tabManager.getTabIds(),
    getTabName: (id: string) => tabManager.getTabName(id),
    getTabCwd: (id: string) => tabManager.getTabCwd(id),
    createTab: (name: string, cwd?: string, shell?: string, existingId?: string) =>
      tabManager.createTab(name, cwd, shell, existingId),
    removeTab: (id: string) => tabManager.removeTab(id),
    focusTab: (tabId: string) => {
      appActor.send({ type: "SWITCH_TAB", tabId });
    },
    splitPane: (targetId: string, direction: "horizontal" | "vertical") =>
      tabManager.splitPane(targetId, direction),
    sendInput: (tabId: string, data: string) => {
      const terminal = ptyManager.get(tabId);
      terminal?.write(data);
    },
    getParser: (tabId: string) => tabManager.getParser(tabId),
    getGitBranch,
    sendTabEvent: (tabId: string, event: Record<string, unknown>) => {
      const actor = tabManager.getTabActor(tabId);
      actor?.send(event as any);
      const type = event.type as string;
      if (type === "AGENT_STARTED") {
        ui.updateAgentStatus(tabId, "busy", event.task as string);
      } else if (type === "AGENT_COMPLETED") {
        ui.updateAgentStatus(tabId, "success");
      } else if (type === "AGENT_ERROR") {
        ui.updateAgentStatus(tabId, "error", event.error as string);
      }
    },
    createWorktreeTab: (params) => tabManager.createWorktreeTab(params),
    removeWorktreeTab: (tabId, force?) => tabManager.removeWorktreeTab(tabId, force),
    isWorktreeTab: (tabId) => tabManager.isWorktreeTab(tabId),
  };

  const rpc = new RpcBridge(agentCtx);
  rpc.start();

  const mcp = new McpHost(agentCtx);
  mcp.start();

  // 13. 恢复 session
  const savedTabs = db.select().from(tabs).orderBy(tabs.order).all();
  if (savedTabs.length > 0) {
    for (const tab of savedTabs) {
      tabManager.createTab(tab.name, tab.cwd ?? undefined, tab.shell ?? undefined, tab.id);
      if (tab.isWorktree || checkIsWorktree(tab.cwd ?? process.cwd())) {
        tabManager.restoreWorktreeInfo(tab.id, true);
      }
    }
    const firstId = tabManager.getTabIds()[0];
    if (firstId) ui.setActiveTab(firstId);
  } else {
    tabManager.createTab("Terminal", process.cwd());
  }
}

main().catch((err) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const logFile = path.join(require("node:os").tmpdir(), "cmux-crash.log");
  const msg = `[${new Date().toISOString()}] ${err?.stack ?? err}\n`;

  try { fs.appendFileSync(logFile, msg); } catch {}
  process.stderr.write(msg);
  process.exit(1);
});
