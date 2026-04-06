## 1. AnsiParser 光标信息提取

- [x] 1.1 在 `src/core/parser/ansi-parser.ts` 中定义 `CursorInfo` 接口：`{ x, y, style, visible }`
- [x] 1.2 实现 `getCursorInfo()` 方法：从 xterm buffer 读取 cursorX/cursorY/cursorBlink/cursorStyle，y 值 clamp 到可见行范围
- [x] 1.3 运行 `bun run type-check` 验证

## 2. AppUI 光标坐标映射与渲染

- [x] 2.1 在 AppUI 中新增 `setPaneCursor(paneId, cursorInfo)` 方法：获取 pane 的 rect 偏移 + parser 的 cursorInfo → 调用 renderer.setCursorPosition
- [x] 2.2 处理分屏边框偏移：screenX = paneLeft + 1 + cursorX（border padding）
- [x] 2.3 新增 `hideCursor()` 方法：设置光标不可见
- [x] 2.4 映射光标样式：xterm "bar" → OpenTUI "line"，调用 renderer.setCursorStyle
- [x] 2.5 运行 `bun run type-check` 验证

## 3. 渲染循环集成

- [x] 3.1 在 main.ts 渲染循环中，grid 更新后获取活跃 tab 的 cursorInfo
- [x] 3.2 调用 ui.setPaneCursor() 设置光标屏幕坐标
- [x] 3.3 调用 ui.hideCursor() 在无活跃 tab 时隐藏光标
- [x] 3.4 确保非活跃 pane 不显示光标（仅 setPaneCursor 对活跃 tab 调用）
- [x] 3.5 运行 `bun run type-check` 验证

## 4. 手动验证

- [ ] 4.1 启动 cmux-bun，确认光标在 prompt 位置正确显示
- [ ] 4.2 输入字符，确认光标跟随移动
- [ ] 4.3 验证分屏模式下光标只在活跃 pane 显示
- [ ] 4.4 验证光标样式跟随 shell 设置（如 PowerShell 的 bar 样式）
