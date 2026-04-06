## Why

`main.ts` 已膨胀至 600+ 行，承担了 PTY 管理、Tab 生命周期、分屏逻辑、键盘处理、命令历史追踪、Agent 上下文组装、会话恢复等所有职责。所有状态通过闭包共享，新增功能只能在 `main()` 内堆叠，导致代码难以测试、理解和扩展。

## What Changes

- 将 `main.ts` 拆分为独立的模块，每个模块封装单一职责
- 提取 `TabManager`：统一管理 Tab 创建/删除/恢复，消除 `createTab` 与 `splitPane` 的重复代码
- 提取 `KeyHandler`：将 200+ 行键盘处理逻辑独立为可测试模块
- 提取 `CommandTracker`：命令历史追踪逻辑独立
- `main.ts` 缩减为编排层：初始化 → 组装模块 → 启动服务
- 保持所有现有功能不变，纯重构

## Capabilities

### New Capabilities
- `tab-manager`: Tab 生命周期统一管理（创建/删除/恢复/PTY绑定），消除 createTab 与 splitPane 的代码重复
- `key-handler`: 键盘事件处理模块（快捷键分发、模式管理、命令累积）
- `command-tracker`: 命令历史追踪（输入累积、prompt 检测、DB 写入）

### Modified Capabilities

## Impact

- `src/main.ts`：从 600+ 行缩减为 ~100 行编排层
- 新增 `src/core/tab-manager.ts`、`src/core/key-handler.ts`、`src/core/command-tracker.ts`
- `src/agents/handlers.ts`：AgentContext 接口不变，实现侧改为调用 TabManager
- `src/ui/app.ts`：接口不变，仍由 main.ts 编排注入
- 无 API 变更、无 Schema 变更、无 DB 变更
