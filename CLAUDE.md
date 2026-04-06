# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

cmux-bun 是一个用 Bun + TypeScript 编写的终端复用器（类似 tmux），运行在 Windows ConPTY 上。它提供多 Tab 终端管理、分屏、命令历史追踪，并通过 MCP 和 JSON-RPC 暴露远程控制接口给外部 Agent（如 Claude Code）。

## 常用命令

```bash
bun run src/main.ts          # 启动应用
bun run build:exe            # 编译为独立 exe (cmux-clone.exe)
bun run type-check           # TypeScript 类型检查 (tsc --noEmit)
bun run db:push              # 推送 Drizzle schema 到 SQLite
```

## 架构

### 模块职责

- **`src/main.ts`** — 入口，编排所有模块：初始化 DB → 创建状态机 → 启动 OpenTUI 渲染器 → 构建 UI → 创建 PTY → 启动渲染循环 → 启动 RPC/MCP 服务 → 恢复会话
- **`src/core/`** — 核心层
  - `pty/` — 基于 bun-pty 的 PTY 管理器（TerminalManager / TerminalInstance）
  - `parser/ansi-parser.ts` — 基于 @xterm/headless 的 ANSI 解析器
  - `layout/layout-tree.ts` — 递归树结构分屏引擎（leaf/split 节点，resolveRects/splitLeaf/removeLeaf）
  - `repo-watcher.ts` — Git 仓库监控
- **`src/ui/`** — 基于 @opentui/core 的 TUI 层
  - `app.ts` — AppUI 类：侧边栏 Tab 列表、分屏 Pane 管理、Overlay（重命名/确认）、Grid→ANSI 渲染
  - `animation.ts` — 呼吸灯动画（根据 Tab 状态驱动边框颜色）
  - `history-overlay.ts` — Ctrl+R 命令历史搜索界面
- **`src/state/`** — XState v5 状态机
  - `app-machine.ts` — 应用级状态（Tab 列表、活跃 Tab、布局、焦点 Pane）
  - `tab-machine.ts` — Tab 级状态（idle → processing → attention，根据 PTY 输出自动检测交互式提示）
- **`src/agents/`** — 外部控制层
  - `handlers.ts` — 共享 handler 逻辑 + AgentContext 接口（agents 不直接依赖 core/state，由 main.ts 注入上下文）
  - `rpc-bridge.ts` — JSON-RPC 2.0 over HTTP，端口 9420
  - `mcp-host.ts` — MCP Streamable HTTP Server，端口 9421，注册 list_tabs/create_tab/close_tab/focus_tab/split_pane/read_tab_output/send_terminal_input/get_git_context 共 8 个 tool
- **`src/contracts/`** — TypeBox schema 定义（RPC 请求/响应、MCP tool 参数、Tab/Pane/Layout/Terminal 类型）
- **`src/db/`** — SQLite + Drizzle ORM（tabs/layouts/command_history 表），数据库位于 `%APPDATA%/cmux/cmux.db`
- **`src/theme.ts`** — 集中颜色主题

### 数据流

```
用户按键 → ui.onKey → main.ts 键盘处理
  ├── Alt+1-9: 切换 Tab (appActor → ui.setActiveTab)
  ├── Alt+r: 重命名 Tab
  ├── Alt+\ / Alt+-: 分屏 (layoutTree.splitLeaf → rebuildPanes)
  ├── Ctrl+R: 命令历史搜索
  └── 其他: 转发给 PTY (ptyManager.write)

PTY 输出 → terminal.onData → ansiParser.feed → dirtyTabs Set
  └── 渲染循环 (30fps setInterval) → ui.updatePaneGrid(parser.getGrid)

外部 Agent → MCP(9421) / RPC(9420) → handlers.ts → AgentContext → 操作 PTY/Tab
```

### 关键设计

- **AgentContext 依赖注入**：`agents/` 模块通过 `AgentContext` 接口访问运行时能力，不直接 import core 或 state，便于测试和解耦
- **脏标记渲染**：PTY 输出标记 `dirtyTabs`，渲染循环只更新脏 Tab，避免全量重绘
- **会话持久化**：Tab 信息存 SQLite，启动时通过 `existingId` 恢复，保证内存 ID 与 DB ID 一致
- **分屏树**：`LayoutNode` 是递归的 leaf | split 结构，支持任意嵌套分屏

## 快捷键

| 按键 | 功能 |
|------|------|
| Alt+1-9 | 切换 Tab |
| Alt+r | 重命名当前 Tab |
| Alt+w | 关闭当前 Tab（带确认） |
| Alt+\\ | 水平分屏 |
| Alt+- | 垂直分屏 |
| Alt+x | 关闭当前 pane |
| Ctrl+R | 命令历史搜索 |
| Ctrl+C | 退出 |

## 端口

- RPC Bridge: `9420`
- MCP Host: `9421`（路径 `/mcp`）
