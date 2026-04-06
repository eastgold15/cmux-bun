## Why

当前 cmux-bun 的终端渲染只显示字符内容，没有显示光标位置。用户无法看到输入焦点在何处，体验上缺少基本的视觉反馈。xterm/headless buffer 已经提供了 cursorX/cursorY/cursorStyle/cursorBlink 数据，OpenTUI renderer 也支持 `setCursorPosition()` / `setCursorStyle()` API，只需要打通这两个环节即可实现光标显示。

## What Changes

- AnsiParser 新增 `getCursorInfo()` 方法，从 xterm buffer 提取光标坐标和样式
- `getGrid()` 返回值扩展，附带光标信息（或独立方法）
- 渲染层在活跃 pane 上渲染光标，使用 OpenTUI 的 `setCursorPosition()` API
- 分屏时将 pane 内部光标坐标转换为屏幕绝对坐标（pane.left + cursorX, pane.top + cursorY）
- 仅渲染当前活跃 pane 的光标（物理终端只有一个光标）

## Capabilities

### New Capabilities
- `cursor-rendering`: 从 xterm buffer 提取光标位置/样式，在活跃 pane 上渲染终端光标

### Modified Capabilities
- `tab-manager`: TabManager 需要新增方法获取活跃 pane 的光标信息和屏幕坐标映射

## Impact

- `src/core/parser/ansi-parser.ts` — 新增 getCursorInfo 方法
- `src/core/tab-manager.ts` — 新增光标坐标映射方法
- `src/ui/app.ts` — 渲染循环中调用 setCursorPosition
- `src/main.ts` — 渲染循环中传递光标信息到 UI
