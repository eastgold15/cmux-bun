## Context

cmux-bun 使用 OpenTUI 作为 TUI 框架，OpenTUI 已内置完整的鼠标事件系统（onMouseDown/onMouseScroll 等），但 cmux-bun 当前完全未启用。终端内运行着 ConPTY 进程，某些应用（vim、less）会通过 CSI 序列请求鼠标追踪，需要在"宿主 UI 控制"和"PTY 鼠标转发"之间做切换。

当前架构：AppUI（app.ts）管理 sidebar tab 列表和 pane 容器，TabManager 管理生命周期，渲染循环在 main.ts 中。鼠标事件需要穿透这些层。

## Goals / Non-Goals

**Goals:**
- 点击 sidebar tab 切换到对应 Tab
- 点击 pane 区域聚焦该 pane（分屏场景）
- Shift+Click 强制宿主控制（即使 PTY 请求了鼠标）
- 分阶段交付：Phase 1 只做 sidebar 点击切换 + pane 聚焦

**Non-Goals:**
- Pane 内鼠标转发给 PTY（Phase 2，需 xterm 鼠标协议检测）
- 文本选择/复制
- Scrollback 缓冲区滚动
- 右键菜单
- 鼠标光标形态切换

## Decisions

### D1: 渲染器配置启用鼠标

在 `createCliRenderer` 中加 `useMouse: true`。不加 `enableMouseMovement: true`（hover 事件暂时不需要，减少事件量）。

**替代方案**：全局 `useMouse: true` + `enableMouseMovement: true`。排除原因：hover 事件频率极高，当前不需要，浪费 CPU。

### D2: 事件绑定在 Renderable 层级

在 `addTab` 中给每个 sidebar `tabItem`（BoxRenderable）绑定 `onMouseDown`，在 `buildPanes` 中给每个 pane box 绑定 `onMouseDown`。不在 renderer 全局拦截再手动命中测试——OpenTUI 的事件分发已基于 Renderable 层级，直接用即可。

**替代方案**：renderer 全局 `on("mouse")` + 手动 hit-test。排除原因：重复造轮子，OpenTUI 已实现。

### D3: Phase 1 不处理鼠标转发

Phase 1 只做 UI 层鼠标交互（tab 切换、pane 聚焦）。PTY 鼠标转发需要检测 xterm 鼠标协议序列（`CSI ? 1000 h` 等），属于独立能力，放到后续 change。

### D4: 回调通过 AppUI 的 onTabClick/onPaneClick 模式

AppUI 暴露 `onTabClick(handler)` 和 `onPaneClick(handler)` 回调注册接口，由 main.ts 注入具体逻辑（通过 TabManager 操作）。保持 AppUI 不直接依赖 state/PTY。

## Risks / Trade-offs

- **[鼠标事件与 PTY 冲突]** → Phase 1 不启用鼠标转发，宿主 UI 完全控制。后续 Phase 2 加协议检测后按需切换。
- **[Windows ConPTY 鼠标支持]** → ConPTY 本身支持 xterm 鼠标协议，Phase 2 转发时只需编码坐标即可。
- **[性能]** → 不启用 `enableMouseMovement`，只处理 click/scroll，事件频率低。
