## Why

cmux-bun 目前只能通过键盘（Alt+1-9）切换 Tab，无法使用鼠标操作。作为终端复用器，鼠标交互是基本期望——用户点击 sidebar tab 切换、点击 pane 聚焦，符合直觉。OpenTUI 已有完整的鼠标事件系统（onMouseDown/onMouseScroll 等），但 cmux-bun 完全未启用。

## What Changes

- 渲染器启用鼠标追踪（`useMouse: true`）
- Sidebar tab 元素绑定 `onMouseDown`，点击即切换 Tab
- Pane 元素绑定 `onMouseDown`，点击切换焦点 pane
- Pane 绑定 `onMouseScroll`，默认发送滚轮事件给 PTY（转义序列格式 `\x1b[M...`）

## Capabilities

### New Capabilities
- `mouse-interaction`: 鼠标事件系统——renderer 鼠标启用、sidebar tab 点击切换、pane 点击聚焦、pane 滚轮转发 PTY

### Modified Capabilities

## Impact

- `src/main.ts` — createCliRenderer 增加 `useMouse: true`
- `src/ui/app.ts` — addTab/buildPanes 中绑定 onMouseDown/onMouseScroll 事件
- `src/core/tab-manager.ts` — 暴露 focusTab 供鼠标事件回调使用
- 无新增依赖，OpenTUI 已内置鼠标支持
