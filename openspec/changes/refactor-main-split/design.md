## Context

当前 `src/main.ts` 是一个 600+ 行的 `main()` 函数，通过闭包共享所有状态。职责包括：
- PTY/Parser/TabActor 的创建与生命周期管理
- 分屏布局的初始化与操作
- 200+ 行的键盘事件 switch/case
- 命令历史追踪（输入累积 + prompt 检测）
- AgentContext 组装与注入
- 数据库会话恢复
- RepoWatcher 管理

所有新功能都要在 main() 内部添加闭包，导致文件持续膨胀。

现有架构层：contracts → core → state → ui → agents → main.ts

## Goals / Non-Goals

**Goals:**
- 将 main.ts 从 600+ 行缩减为 ~100 行编排层
- 提取 3 个独立模块：TabManager、KeyHandler、CommandTracker
- 消除 `createTab` 与 `splitPane` 中 PTY/Parser/TabActor 创建的重复代码
- 模块间通过明确的接口通信，不再依赖闭包共享
- 纯重构，不改变任何外部行为

**Non-Goals:**
- 不引入依赖注入框架（手动注入即可）
- 不改变 MCP/RPC 的 API 或 Schema
- 不改变 UI 组件的接口
- 不改变 XState 状态机的定义
- 不做配置化或插件化（那是后续变更）

## Decisions

### Decision 1: TabManager 作为核心编排模块

从 main.ts 中提取 PTY/Parser/TabActor 的创建、销毁、resize 逻辑到 `src/core/tab-manager.ts`。

**接口设计：**
```typescript
interface TabManager {
  createTab(id: string, name: string, cwd?: string, shell?: string): TabHandle;
  removeTab(id: string): void;
  splitPane(targetId: string, direction: "horizontal" | "vertical", appActor: AppActor, layoutRoot: LayoutNode): { newId: string; layoutRoot: LayoutNode };
  write(tabId: string, data: string): void;
  resize(tabId: string, cols: number, rows: number): void;
  getParser(tabId: string): AnsiParser | undefined;
  getActor(tabId: string): TabActor | undefined;
  getCwd(tabId: string): string | undefined;
  setCwd(tabId: string, cwd: string): void;
  killAll(): void;
}
```

**替代方案：** 直接暴露内部 Map。→ 拒绝：违反封装，不利于后续替换实现。

**原因：** createTab 和 splitPane 中有约 40 行重复的 PTY/Parser/Actor 创建代码，TabManager 统一消除。

### Decision 2: KeyHandler 独立为事件处理器

将键盘处理逻辑提取到 `src/core/key-handler.ts`，接收 key 事件并分发到对应操作。

**设计：** KeyHandler 持有对 TabManager、AppUI、AppActor 的引用，通过回调通知 main 层的特殊操作（如 session restore）。

```typescript
interface KeyHandler {
  handle(key: string): void;
  isSearchMode(): boolean;
}
```

**替代方案：** 用 XState 状态机管理键盘模式。→ 暂不引入，当前 switch/case 模式足够清晰，提取即可。

### Decision 3: CommandTracker 独立追踪命令

提取命令输入累积、prompt 检测、DB 写入到 `src/core/command-tracker.ts`。

```typescript
interface CommandTracker {
  feedKey(key: string, tabId: string, cwd: string): void;
  feedOutput(tabId: string, parser: AnsiParser): void;
  reset(): void;
}
```

### Decision 4: Worktree 功能集成到 TabManager

`createWorktreeTab` 和 `removeWorktreeTab` 闭包直接内聚到 TabManager 中，不再散落在 main.ts。

### Decision 5: 模块间通信

```
┌─────────────────────────────────────────────┐
│                  main.ts                     │
│          (编排层 ~100 行)                    │
│                                             │
│  init() → 创建模块 → 注入依赖 → 启动服务     │
└──────┬──────────┬───────────┬───────────────┘
       │          │           │
  ┌────▼───┐ ┌───▼────┐ ┌───▼──────────┐
  │TabMgr  │ │KeyHdlr │ │CommandTracker│
  │        │ │        │ │              │
  │PTY管理 │ │快捷键  │ │输入累积      │
  │Parser  │ │模式切换│ │prompt检测    │
  │TabActor│ │overlay │ │DB写入        │
  │Worktree│ │        │ │              │
  └────┬───┘ └───┬────┘ └──────────────┘
       │         │
  ┌────▼─────────▼────┐
  │      AppUI         │
  │  (接口不变)         │
  └────────────────────┘
```

模块间通过 main.ts 注入的引用通信，不直接互相 import。

## Risks / Trade-offs

- **[重构风险] 拆分过程中可能引入回归 bug** → 每个模块提取后立即运行 `bun run type-check`，最终手动启动验证
- **[接口过度抽象] 如果接口设计不当，可能增加复杂度而非降低** → 保持接口最小化，只暴露 main.ts 实际需要的方法
- **[闭包状态迁移] 当前闭包捕获了 `dirtyTabs`、`tabCwds` 等局部状态** → 这些状态迁移到 TabManager 内部，通过 getter 暴露
