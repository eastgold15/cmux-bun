## ADDED Requirements

### Requirement: AnsiParser 提取光标信息
AnsiParser SHALL 提供 `getCursorInfo()` 方法，从 xterm buffer 提取当前光标位置和样式。

#### Scenario: 获取光标位置
- **WHEN** 调用 `parser.getCursorInfo()`
- **THEN** 返回 `{ x: number, y: number, style, visible }`，x/y 为 0-based 坐标

#### Scenario: 光标样式跟随 shell 设置
- **WHEN** shell 设置了光标样式（如 CSI ? 12 h 设置 bar 样式）
- **THEN** getCursorInfo() 返回对应的 style 值（"block" | "underline" | "bar"）

#### Scenario: 光标在可见范围内
- **WHEN** buffer 发生滚动，cursorY 指向 scrollback 区域
- **THEN** getCursorInfo() 返回的 y 值被 clamp 到可见行范围 [0, rows-1]

### Requirement: 活跃 Pane 显示终端光标
系统 SHALL 在当前活跃 pane 上渲染终端光标，位置与 shell 输入位置一致。

#### Scenario: 单 pane 模式显示光标
- **WHEN** 终端处于单 pane 模式
- **THEN** 光标显示在 shell prompt 末尾位置，使用 setCursorPosition 设置坐标

#### Scenario: 分屏模式下显示光标
- **WHEN** 终端处于分屏模式，活跃 pane 为 pane A
- **THEN** 光标坐标 = pane A 的屏幕偏移 + pane 内部光标坐标
- **AND** 仅活跃 pane 显示光标，非活跃 pane 不显示

#### Scenario: 切换 pane 时光标跟随
- **WHEN** 用户切换活跃 pane
- **THEN** 光标立即移动到新活跃 pane 的光标位置

### Requirement: 光标样式渲染
系统 SHALL 根据光标样式设置正确渲染光标外观。

#### Scenario: block 样式
- **WHEN** 光标样式为 "block"
- **THEN** 渲染为覆盖当前字符的方块

#### Scenario: bar 样式
- **WHEN** 光标样式为 "bar"
- **THEN** 渲染为字符左侧的竖线

#### Scenario: underline 样式
- **WHEN** 光标样式为 "underline"
- **THEN** 渲染为字符下方的下划线
