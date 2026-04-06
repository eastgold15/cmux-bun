## ADDED Requirements

### Requirement: KeyHandler 模块化键盘事件处理
系统 SHALL 提供 KeyHandler 模块，接收键盘事件并分发到对应操作（Tab 切换、分屏、重命名、搜索等）。

#### Scenario: Alt+数字切换 Tab
- **WHEN** 用户按下 Alt+1 到 Alt+9
- **THEN** KeyHandler 切换到对应索引的 Tab

#### Scenario: Alt+\ 水平分屏
- **WHEN** 用户按下 Alt+\
- **THEN** KeyHandler 调用 TabManager.splitPane 进行水平分屏

#### Scenario: Alt+W 关闭 Tab
- **WHEN** 用户按下 Alt+W
- **THEN** KeyHandler 显示确认弹窗，确认后调用 TabManager.removeTab

#### Scenario: Ctrl+R 进入搜索模式
- **WHEN** 用户按下 Ctrl+R
- **THEN** KeyHandler 创建 HistoryOverlay 进入搜索模式，拦截后续按键

### Requirement: KeyHandler 管理交互模式
KeyHandler SHALL 管理搜索模式、重命名模式、确认模式的状态转换，在模式激活时拦截所有按键。

#### Scenario: 搜索模式退出
- **WHEN** 搜索模式激活时用户按下 Escape
- **THEN** KeyHandler 关闭 HistoryOverlay，退出搜索模式

#### Scenario: 普通按键转发
- **WHEN** 无特殊模式激活时用户按下可打印字符
- **THEN** KeyHandler 将按键转发给当前活跃 Tab 的 PTY
