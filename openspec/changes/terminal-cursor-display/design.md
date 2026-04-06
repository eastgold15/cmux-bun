## Context

cmux-bun 使用 `@xterm/headless` 解析 PTY 输出，通过 `getGrid()` 提取 Cell[][] 渲染终端内容。当前渲染管线只传输字符和颜色，未传递光标位置。

xterm buffer 已暴露：
- `buf.cursorX` / `buf.cursorY` — 光标在 buffer 中的行列坐标
- `buf.cursorBlink` — 是否闪烁
- `buf.cursorStyle` — "block" | "underline" | "bar" | "default"

OpenTUI renderer 支持：
- `setCursorPosition(x, y, visible)` — 设置光标屏幕坐标
- `setCursorStyle(options)` — 设置样式
- `setCursorColor(color)` — 设置颜色

关键约束：物理终端只有一个光标，分屏时只能显示活跃 pane 的光标。

现有模块：AnsiParser → TabManager（isDirty/getParser）→ main.ts 渲染循环 → AppUI（updatePaneGrid/updateTerminalGrid）

## Goals / Non-Goals

**Goals:**
- 在活跃 pane 上显示终端光标，位置与 shell 输入位置一致
- 支持 block/underline/bar 三种光标样式（跟随 shell 设置）
- 分屏时正确计算光标的屏幕绝对坐标
- 性能：不增加渲染循环的显著开销

**Non-Goals:**
- 不实现光标闪烁动画（使用终端默认行为）
- 不为非活跃 pane 显示虚拟光标（如灰色光标）
- 不改变 xterm cursorStyle 之外的任何光标行为

## Decisions

### Decision 1: AnsiParser 新增 getCursorInfo() 方法

返回 `{ x, y, style, visible }` 结构，独立于 getGrid()。

**原因：** 光标信息和 grid 内容是不同概念。getGrid() 已有缓存逻辑（generation 检测），光标位置变化频繁（每次按键都移动），不应耦合在一起。

**替代方案：** 在 getGrid() 返回值中附带 cursor 字段 → 拒绝：改变现有接口签名，所有调用方都需要适配。

```typescript
interface CursorInfo {
  x: number;           // 列号（0-based）
  y: number;           // 行号（0-based）
  style: "block" | "underline" | "bar" | "default";
  visible: boolean;    // cursorBlink + terminal focused
}
```

### Decision 2: 渲染循环中获取光标并设置

在 main.ts 的 30fps 渲染循环中，更新完 grid 后检查活跃 pane 的光标信息，调用 `renderer.setCursorPosition()` 和 `renderer.setCursorStyle()`。

**坐标映射：**
```
screenX = pane.rect.x + cursorInfo.x + 1  // +1 for border padding
screenY = pane.rect.y + cursorInfo.y + 1
```

**原因：** 渲染循环已经有 isDirty 检测逻辑，光标更新可以自然融入，不需要额外事件。

### Decision 3: TabManager 提供 getCursorScreenPosition() 方法

封装坐标映射逻辑：获取活跃 pane 的 rect + parser 的 cursorInfo → 返回屏幕坐标。

**原因：** main.ts 编排层不应关心坐标映射细节，这是 TabManager 的职责。

## Risks / Trade-offs

- **[光标抖动]** 渲染频率 30fps，光标可能在 grid 更新后延迟一帧显示 → 可接受，用户感知不明显
- **[分屏边框偏移]** pane 的 rect 计算需要考虑边框宽度，偏移错误会导致光标位置偏移 → 需要与现有 `getVisiblePaneSizes()` / `getPaneRect()` 对齐
- **[xterm buffer 滚动]** cursorY 可能指向 scrollback 区域，需要 clamp 到可见范围 → getCursorInfo() 中处理
