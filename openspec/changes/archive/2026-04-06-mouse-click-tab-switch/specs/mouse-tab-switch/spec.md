## ADDED Requirements

### Requirement: Sidebar Tab 鼠标点击切换

AppUI SHALL 在每个 sidebar tab 的 BoxRenderable 上绑定 `onMouseDown` 事件。当用户点击某个 tab 的 sidebar 区域时，系统 SHALL 将活跃 Tab 切换到被点击的 Tab。

#### Scenario: 点击非活跃 Tab
- **WHEN** 用户点击当前非活跃 Tab 的 sidebar 项
- **THEN** 系统 SHALL 调用 `appActor.send({ type: "SWITCH_TAB", tabId })` 切换状态
- AND UI SHALL 更新 sidebar 高亮为被点击的 Tab
- AND UI SHALL 刷新右侧终端内容为该 Tab 的 parser grid
- AND UI SHALL 将 `focusedPaneId` 设为该 tabId

#### Scenario: 点击已活跃的 Tab
- **WHEN** 用户点击当前已活跃 Tab 的 sidebar 项
- **THEN** 系统 SHALL 不做任何状态变更（幂等）

### Requirement: 鼠标事件回调注册

AppUI SHALL 暴露 `onTabClick(handler: (tabId: string) => void)` 方法，由 main.ts 注册具体切换逻辑。AppUI 不直接依赖 appActor 或 TabManager。

#### Scenario: 注册 tab 点击回调
- **WHEN** main.ts 调用 `ui.onTabClick(callback)`
- **THEN** AppUI SHALL 存储该回调并在 sidebar tab 被点击时调用
- AND 回调参数 SHALL 为被点击 tab 的 ID 字符串
