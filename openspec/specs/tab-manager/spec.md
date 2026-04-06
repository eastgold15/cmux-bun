## ADDED Requirements

### Requirement: TabManager 统一管理 Tab 生命周期
系统 SHALL 提供 TabManager 模块，封装 PTY/Parser/TabActor 的创建、销毁和状态查询。所有 Tab 相关操作通过 TabManager 统一入口执行。

#### Scenario: 创建新 Tab
- **WHEN** 调用 `tabManager.createTab(name, cwd)`
- **THEN** 自动创建 PTY 实例、AnsiParser、TabActor，注册 RepoWatcher，写入 DB，返回 tab ID

#### Scenario: 删除 Tab
- **WHEN** 调用 `tabManager.removeTab(tabId)`
- **THEN** 自动注销 RepoWatcher、销毁 PTY、清理 Parser/Actor、从 DB 删除、从布局中移除

#### Scenario: 分屏创建新 Pane
- **WHEN** 调用 `tabManager.splitPane(targetId, direction)`
- **THEN** 复用 createTab 逻辑创建新 Tab，更新布局树，resize 所有可见 Pane

### Requirement: TabManager 管理 worktree Tab
TabManager SHALL 支持 worktree Tab 的创建和删除，封装 git worktree 操作。

#### Scenario: 创建 worktree Tab
- **WHEN** 调用 `tabManager.createWorktreeTab({ branch, tabName, baseTabId })`
- **THEN** 执行 git worktree add，创建 Tab 指向 worktree 路径，标记 isWorktree，更新 UI

#### Scenario: 删除 worktree Tab
- **WHEN** 调用 `tabManager.removeWorktreeTab(tabId, force)`
- **THEN** 执行 git worktree remove，关闭 Tab，清理资源

### Requirement: TabManager 提供 AgentContext 所需的查询方法
TabManager SHALL 提供 `getActiveTabId`、`getTabIds`、`getTabName`、`getTabCwd`、`getParser`、`isWorktreeTab` 等查询方法。

#### Scenario: 查询 Tab 信息
- **WHEN** Agent 通过 MCP/RPC 查询 Tab 状态
- **THEN** 通过 TabManager 的查询方法返回准确的 Tab 信息
