## ADDED Requirements

### Requirement: Pane 鼠标点击聚焦

AppUI SHALL 在 `buildPanes` 创建的每个 pane BoxRenderable 上绑定 `onMouseDown` 事件。当用户点击某个 pane 时，系统 SHALL 将焦点切换到该 pane。

#### Scenario: 点击非焦点 pane
- **WHEN** 分屏模式下用户点击一个非焦点的 pane
- **THEN** 系统 SHALL 更新 `focusedPaneId` 为该 pane 的 ID
- AND 系统 SHALL 通过 TabManager 通知 appActor 切换活跃 Tab
- AND UI SHALL 刷新 pane 边框颜色（活跃 pane 高亮，其他 pane 恢复 idle）
- AND UI SHALL 刷新右侧终端内容为该 pane 的 parser grid

#### Scenario: 点击已焦点 pane
- **WHEN** 用户点击当前已聚焦的 pane
- **THEN** 系统 SHALL 不做任何状态变更（幂等）

### Requirement: Pane 点击回调注册

AppUI SHALL 暴露 `onPaneClick(handler: (paneId: string) => void)` 方法，由 main.ts 注册具体聚焦逻辑。

#### Scenario: 注册 pane 点击回调
- **WHEN** main.ts 调用 `ui.onPaneClick(callback)`
- **THEN** AppUI SHALL 存储该回调并在 pane 被点击时调用
- AND 回调参数 SHALL 为被点击 pane 的 ID 字符串
