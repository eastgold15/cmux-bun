## ADDED Requirements

### Requirement: CommandTracker 独立追踪命令历史
系统 SHALL 提供 CommandTracker 模块，独立管理用户输入累积、命令边界检测和 DB 写入。

#### Scenario: 累积用户输入
- **WHEN** 用户在终端中输入可打印字符
- **THEN** CommandTracker 将字符追加到 pendingCommand 缓冲区

#### Scenario: 检测命令提交
- **WHEN** 用户按下 Enter 且 pendingCommand 非空
- **THEN** CommandTracker 将命令写入 DB，清空缓冲区

#### Scenario: 检测命令完成
- **WHEN** PTY 输出中出现 shell prompt 模式
- **THEN** CommandTracker 标记当前命令已完成，记录结束时间

#### Scenario: Backspace 处理
- **WHEN** 用户按下 Backspace
- **THEN** CommandTracker 从 pendingCommand 末尾删除一个字符

#### Scenario: Ctrl+C 取消
- **WHEN** 用户按下 Ctrl+C
- **THEN** CommandTracker 清空 pendingCommand 缓冲区
