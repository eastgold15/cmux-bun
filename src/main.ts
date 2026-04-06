import { createCliRenderer } from "@opentui/core";
import { TerminalManager } from "./core/pty/terminal-manager.js";
import { AppUI } from "./ui/app.js";
import { AnsiParser } from "./core/parser/ansi-parser.js";
import { createAppActor } from "./state/app-machine.js";
import { createTabActor } from "./state/tab-machine.js";
import { RpcBridge, McpHost, type AgentContext } from "./agents/index.js";
import { db, runMigrations } from "./db/connection.js";
import { tabs } from "./db/schema.js";
import { eq } from "drizzle-orm";
import { getGitBranch } from "./utils/git.js";
import { isWorktree as checkIsWorktree, createWorktree, removeWorktree as removeWorktreeDir } from "./utils/worktree.js";
import { getAnimatedBorderColor } from "./ui/animation.js";
import { RepoWatcherManager } from "./core/repo-watcher-manager.js";
import { addCommand, finishCommand } from "./db/history.js";
import { HistoryOverlay } from "./ui/history-overlay.js";
import type { AnimationState } from "./ui/animation.js";
import {
  type LayoutNode,
  splitLeaf,
  removeLeaf as removeLeafFromLayout,
  collectLeaves,
  getAdjacentLeaf,
  adjustRatio,
} from "./core/layout/layout-tree.js";

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
    clearInterval(gitPoll);
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
  const tabCwds = new Map<string, string>();
  const tabWorktreeInfo = new Map<string, { isWorktree: boolean }>();
  const watcherManager = new RepoWatcherManager();
  let layoutRoot: LayoutNode | null = null;

  /** 根据 layoutRoot 重建 UI pane 并 resize 对应 PTY */
  function rebuildPanes() {
    if (!layoutRoot) return;
    ui.buildPanes(layoutRoot);
    // resize 所有可见 pane 的 PTY
    const sizes = ui.getVisiblePaneSizes();
    for (const [id, { cols, rows }] of sizes) {
      ptyManager.resize(id, cols, rows);
      parsers.get(id)?.resize(cols, rows);
    }
  }

  // 5.5 命令历史追踪
  let pendingCommand = "";               // 累积当前用户输入的命令文本
  let activeCommandId: string | null = null; // 当前正在执行的命令 DB id
  let isSearchMode = false;              // Ctrl+R 搜索模式
  let historyOverlay: HistoryOverlay | null = null;

  // Shell prompt 模式：匹配常见 shell 的提示符结尾
  const PROMPT_PATTERN = /[\$#>]\s*$/;
  const PS_PATTERN = /PS\s+[A-Z]:\\.*>\s*$/;

  // 6. Resize 联动
  ui.onResize((_containerWidth, _containerHeight) => {
    if (layoutRoot) {
      rebuildPanes();
    } else {
      const activeId = appActor.getSnapshot().context.activeTabId;
      if (activeId) {
        const size = ui.getViewportSize();
        ptyManager.resize(activeId, size.cols, size.rows);
        parsers.get(activeId)?.resize(size.cols, size.rows);
      }
    }
  });

  // 7. 渲染循环 ~30fps
  const renderLoop = setInterval(() => {
    const state = appActor.getSnapshot();
    const activeId = state.context.activeTabId;

    // 呼吸灯动画：根据 tab 状态驱动视窗边框颜色
    if (activeId) {
      const actor = tabActors.get(activeId);
      if (actor) {
        const tabState = actor.getSnapshot().value as AnimationState;
        ui.setViewportBorderColor(getAnimatedBorderColor(tabState));
      }
    }

    // 终端内容更新：遍历所有可见 pane
    if (layoutRoot) {
      const leaves = collectLeaves(layoutRoot);
      for (const tabId of leaves) {
        if (dirtyTabs.has(tabId)) {
          const parser = parsers.get(tabId);
          if (parser) {
            ui.updatePaneGrid(tabId, parser.getGrid());
          }
          dirtyTabs.delete(tabId);
        }
      }
    } else if (activeId && dirtyTabs.has(activeId)) {
      const parser = parsers.get(activeId);
      if (parser) {
        ui.updateTerminalGrid(parser.getGrid());
      }
      dirtyTabs.delete(activeId);
    }
  }, 32);

  // 7.5 Git 分支轮询（每 5 秒 + 切换 tab 时）
  function refreshGitBranches() {
    for (const [id, cwd] of tabCwds) {
      const branch = getGitBranch(cwd);
      ui.updateTabBranch(id, branch);
    }
  }
  const gitPoll = setInterval(refreshGitBranches, 5000);

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

      // 命令边界检测：PTY 输出中出现 prompt → 上一条命令结束
      if (activeCommandId && activeId === id) {
        const lines = parser.getRows();
        for (let i = lines.length - 1; i >= Math.max(0, lines.length - 3); i--) {
          const line = lines[i]?.trimEnd();
          if (!line) continue;
          if (PROMPT_PATTERN.test(line) || PS_PATTERN.test(line)) {
            finishCommand(activeCommandId, null);
            activeCommandId = null;
            break;
          }
        }
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

    // 初始化单 pane 布局（确保右侧有 viewport 显示终端内容）
    if (!layoutRoot) {
      layoutRoot = { type: "leaf", tabId: id };
      rebuildPanes();
      ui.focusPane(id);
    }

    // 记录 cwd 并检测 git 分支
    const resolvedCwd = cwd ?? process.cwd();
    tabCwds.set(id, resolvedCwd);
    ui.updateTabBranch(id, getGitBranch(resolvedCwd));

    // 注册 RepoWatcher（git 变化时刷新分支显示）
    watcherManager.watch(id, resolvedCwd, () => {
      const branch = getGitBranch(resolvedCwd);
      ui.updateTabBranch(id, branch);
    });

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
    watcherManager.unwatch(id);
    ptyManager.kill(id);
    parsers.delete(id);
    dirtyTabs.delete(id);
    tabCwds.delete(id);
    const actor = tabActors.get(id);
    actor?.stop();
    tabActors.delete(id);
    ui.removeTab(id);
    appActor.send({ type: "REMOVE_TAB", tabId: id });
    db.delete(tabs).where(eq(tabs.id, id)).run();

    // 更新布局：从 layout 中移除该叶子
    if (layoutRoot) {
      layoutRoot = removeLeafFromLayout(layoutRoot, id);
      if (layoutRoot) {
        rebuildPanes();
      } else {
        layoutRoot = null;
      }
    }
  }

  // 9.4 Worktree 管理：创建 worktree 并自动创建 Tab
  async function createWorktreeTab(params: {
    branch: string;
    tabName?: string;
    baseTabId?: string;
  }): Promise<{ tabId: string; path: string; branch: string }> {
    // 确定主仓库路径
    let mainRepoPath: string;
    if (params.baseTabId) {
      mainRepoPath = tabCwds.get(params.baseTabId) ?? process.cwd();
    } else {
      const activeId = appActor.getSnapshot().context.activeTabId;
      mainRepoPath = activeId ? (tabCwds.get(activeId) ?? process.cwd()) : process.cwd();
    }

    // 创建 worktree
    const { path: worktreePath, branch } = createWorktree({
      mainRepoPath,
      branch: params.branch,
    });

    const tabName = params.tabName ?? branch;
    const tabId = createTab(tabName, worktreePath);

    // 标记为 worktree
    tabWorktreeInfo.set(tabId, { isWorktree: true });

    // 更新 UI 显示 worktree 标识
    ui.updateTabWorktree(tabId, true);

    // 持久化 isWorktree 到数据库
    db.update(tabs).set({ isWorktree: true }).where(eq(tabs.id, tabId)).run();

    return { tabId, path: worktreePath, branch };
  }

  // 9.4.1 Worktree 管理：移除 worktree 并关闭 Tab
  async function removeWorktreeTab(tabId: string, force = false): Promise<{ ok: boolean }> {
    const cwd = tabCwds.get(tabId);
    if (!cwd) throw new Error(`Tab ${tabId} not found`);

    const removed = removeWorktreeDir(cwd, force);
    if (!removed && !force) {
      throw new Error("移除 worktree 失败，可能存在未提交的更改。使用 force=true 强制移除");
    }

    tabWorktreeInfo.delete(tabId);
    removeTab(tabId);
    return { ok: true };
  }

  // 判断 Tab 是否为 worktree
  function isWorktreeTab(tabId: string): boolean {
    return tabWorktreeInfo.get(tabId)?.isWorktree ?? false;
  }

  // 9.5 分屏：在指定 tab 旁创建新 pane
  function splitPane(targetId: string, direction: "horizontal" | "vertical") {
    const newId = `tab-${Date.now()}`;
    const name = `Terminal`;

    // 初始化布局（首次分屏）
    if (!layoutRoot) {
      layoutRoot = { type: "leaf", tabId: targetId };
    }

    // 在 layout 中切分
    layoutRoot = splitLeaf(layoutRoot, targetId, newId, direction);

    // 创建新 tab 的 PTY 和 parser
    ui.buildPanes(layoutRoot);
    const size = ui.getPaneSize(newId);
    const parser = new AnsiParser(size.cols, size.rows);
    parsers.set(newId, parser);

    const terminal = ptyManager.create(newId, { cols: size.cols, rows: size.rows });

    const tabActor = createTabActor(newId, name, process.cwd());
    tabActor.start();
    tabActors.set(newId, tabActor);

    terminal.onData((data) => {
      parser.feed(data);
      tabActor.send({ type: "DATA_RECEIVED", data });
      dirtyTabs.add(newId);
    });

    terminal.onExit((code) => {
      tabActor.send({ type: "PROCESS_EXITED", code });
    });

    parser.onNotify(() => {
      tabActor.send({ type: "DETECT_NOTIFY_SIGNAL" });
    });

    ui.addTab(newId, name);
    appActor.send({ type: "ADD_TAB", tabId: newId });
    tabCwds.set(newId, process.cwd());

    // 焦点切到新 pane
    ui.focusPane(newId);
    appActor.send({ type: "FOCUS_PANE", tabId: newId });
    appActor.send({ type: "SWITCH_TAB", tabId: newId });
    ui.setActiveTab(newId);

    // resize 所有可见 pane
    rebuildPanes();

    // 写入数据库
    db.insert(tabs).values({
      id: newId,
      name,
      cwd: process.cwd(),
      shell: "cmd.exe",
      order: appActor.getSnapshot().context.tabIds.length,
    }).run();
  }

  // 10. 键盘处理
  ui.onKey((key: string) => {
    const state = appActor.getSnapshot();
    const activeId = state.context.activeTabId;

    // 10.0 搜索模式：拦截所有按键
    if (isSearchMode && historyOverlay) {
      if (key === "\x1b" || key === "\x03") {
        // Escape / Ctrl+C: 关闭搜索
        historyOverlay.hide();
        historyOverlay = null;
        isSearchMode = false;
        ui.updateStatusBar(" Alt+1-9:Tab | Alt+r:重命名 | Alt+w:关闭 | Ctrl+R:搜索 | Ctrl+C:退出");
      } else if (key === "\r") {
        // Enter: 插入选中命令到 PTY
        const selected = historyOverlay.getSelected();
        historyOverlay.hide();
        historyOverlay = null;
        isSearchMode = false;
        ui.updateStatusBar(" Alt+1-9:Tab | Alt+r:重命名 | Alt+w:关闭 | Ctrl+R:搜索 | Ctrl+C:退出");
        if (selected && activeId) {
          const terminal = ptyManager.get(activeId);
          terminal?.write(selected);
          pendingCommand = selected;
        }
      } else if (key === "\x1b[A") {
        // 上箭头
        historyOverlay.moveUp();
      } else if (key === "\x1b[B") {
        // 下箭头
        historyOverlay.moveDown();
      } else if (key === "\x7f" || key === "\x08") {
        // Backspace
        historyOverlay.backspaceQuery();
        ui.updateStatusBar(` 搜索: ${historyOverlay.currentQuery} | Enter:插入 | Esc:取消 | ↑↓:选择`);
      } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
        // 可打印字符
        historyOverlay.appendQuery(key);
        ui.updateStatusBar(` 搜索: ${historyOverlay.currentQuery} | Enter:插入 | Esc:取消 | ↑↓:选择`);
      }
      return;
    }

    // 10.1 重命名模式：拦截所有按键
    if (ui.isRenaming) {
      ui.handleRenameKey(key);
      return;
    }

    // 10.2 关闭确认模式：拦截所有按键
    if (ui.isConfirming) {
      ui.handleConfirmKey(key);
      return;
    }

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
          const cwd = tabCwds.get(newActiveId);
          if (cwd) ui.updateTabBranch(newActiveId, getGitBranch(cwd));
        }
        return;
      }

      // Alt+r: 重命名当前 Tab
      if (key === "\x1br") {
        if (activeId) {
          const actor = tabActors.get(activeId);
          const currentName = actor?.getSnapshot().context.name ?? "Tab";
          ui.showRenameOverlay(currentName).then((newName) => {
            if (newName && activeId) {
              ui.updateTabName(activeId, newName);
              // 更新 tabActor 中的 name
              const actor = tabActors.get(activeId);
              if (actor) {
                (actor.getSnapshot().context as any).name = newName;
              }
              // 持久化到 DB
              db.update(tabs).set({ name: newName }).where(eq(tabs.id, activeId)).run();
            }
          });
        }
        return;
      }

      // Alt+w: 关闭当前 Tab（带确认）
      if (key === "\x1bw") {
        if (activeId) {
          const actor = tabActors.get(activeId);
          const tabName = actor?.getSnapshot().context.name ?? "Tab";
          const ptyInstance = ptyManager.get(activeId);
          if (ptyInstance) {
            ui.showConfirmOverlay(tabName).then((confirmed) => {
              if (confirmed && activeId) {
                removeTab(activeId);
              }
            });
          } else {
            removeTab(activeId);
          }
        }
        return;
      }

      // Alt+\: 水平分屏
      if (key === "\x1b\\") {
        if (activeId) splitPane(activeId, "horizontal");
        return;
      }

      // Alt+-: 垂直分屏
      if (key === "\x1b-") {
        if (activeId) splitPane(activeId, "vertical");
        return;
      }

      // Alt+x: 关闭当前 pane
      if (key === "\x1bx") {
        if (activeId && layoutRoot) {
          const leaves = collectLeaves(layoutRoot);
          if (leaves.length > 1) {
            removeTab(activeId);
          }
        }
        return;
      }
    }

    // Ctrl+R: 打开历史搜索
    if (key === "\x12") {
      isSearchMode = true;
      historyOverlay = new HistoryOverlay(renderer);
      historyOverlay.show();
      ui.updateStatusBar(" 搜索: | Enter:插入 | Esc:取消 | ↑↓:选择");
      return;
    }

    // Ctrl+C 退出（兜底在 stdin data 监听里）
    if (key === "\x03") {
      gracefulExit();
    }

    // 命令追踪：累积用户输入
    if (activeId) {
      if (key === "\r" || key === "\n") {
        // Enter: 记录命令
        const cwd = tabCwds.get(activeId) ?? process.cwd();
        const trimmed = pendingCommand.trim();
        if (trimmed.length > 0) {
          activeCommandId = addCommand(activeId, trimmed, cwd);
        }
        pendingCommand = "";
      } else if (key === "\x7f" || key === "\x08") {
        // Backspace
        pendingCommand = pendingCommand.slice(0, -1);
      } else if (key === "\x03") {
        // Ctrl+C: 清空累积
        pendingCommand = "";
      } else if (key.length === 1 && key.charCodeAt(0) >= 32) {
        // 可打印字符
        pendingCommand += key;
      }
      // 其他控制序列（方向键、Tab补全等）不修改 pendingCommand
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

  // 12. Agents (RPC Bridge + MCP Host)
  const agentCtx: AgentContext = {
    getActiveTabId: () => appActor.getSnapshot().context.activeTabId,
    getTabIds: () => appActor.getSnapshot().context.tabIds as string[],
    getTabName: (id: string) => {
      const actor = tabActors.get(id);
      return actor?.getSnapshot().context.name ?? "Tab";
    },
    getTabCwd: (id: string) => tabCwds.get(id),
    createTab,
    removeTab,
    focusTab: (tabId: string) => {
      appActor.send({ type: "SWITCH_TAB", tabId });
    },
    splitPane,
    sendInput: (tabId: string, data: string) => {
      const terminal = ptyManager.get(tabId);
      terminal?.write(data);
    },
    getParser: (tabId: string) => parsers.get(tabId),
    getGitBranch,
    sendTabEvent: (tabId: string, event: Record<string, unknown>) => {
      const actor = tabActors.get(tabId);
      actor?.send(event as any);
      // 同步更新 UI 的 Agent 生命周期状态
      const type = event.type as string;
      if (type === "AGENT_STARTED") {
        ui.updateAgentStatus(tabId, "busy", event.task as string);
      } else if (type === "AGENT_COMPLETED") {
        ui.updateAgentStatus(tabId, "success");
      } else if (type === "AGENT_ERROR") {
        ui.updateAgentStatus(tabId, "error", event.error as string);
      }
    },
    createWorktreeTab,
    removeWorktreeTab,
    isWorktreeTab,
  };

  const rpc = new RpcBridge(agentCtx);
  rpc.start();

  const mcp = new McpHost(agentCtx);
  mcp.start();

  // 13. 恢复 session：用数据库中的 id 作为 existingId，保证 ID 一致
  const savedTabs = db.select().from(tabs).orderBy(tabs.order).all();
  if (savedTabs.length > 0) {
    for (const tab of savedTabs) {
      createTab(tab.name, tab.cwd ?? undefined, tab.shell ?? undefined, tab.id);
      // 恢复 worktree 元数据
      if (tab.isWorktree || checkIsWorktree(tab.cwd ?? process.cwd())) {
        tabWorktreeInfo.set(tab.id, { isWorktree: true });
        ui.updateTabWorktree(tab.id, true);
      }
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
