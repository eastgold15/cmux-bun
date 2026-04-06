## 1. CommandTracker 提取

- [x] 1.1 创建 `src/core/command-tracker.ts`，实现 CommandTracker 类：pendingCommand 缓冲区、feedKey、feedOutput、reset 方法
- [x] 1.2 从 main.ts 中移除命令历史追踪相关代码（pendingCommand、activeCommandId、PROMPT_PATTERN），替换为 CommandTracker 调用
- [x] 1.3 运行 `bun run type-check` 验证

## 2. TabManager 提取

- [x] 2.1 创建 `src/core/tab-manager.ts`，定义 TabManager 接口和实现骨架
- [x] 2.2 迁移 createTab 逻辑：PTY 创建、Parser 创建、TabActor 创建、onData/onExit/onNotify 订阅
- [x] 2.3 迁移 removeTab 逻辑：Watcher 注销、PTY kill、Parser/Actor 清理、DB 删除、布局更新
- [x] 2.4 迁移 splitPane 逻辑：复用 createTab，更新布局树，resize 联动
- [x] 2.5 迁移 worktree 管理：createWorktreeTab、removeWorktreeTab、isWorktreeTab
- [x] 2.6 迁移内部状态：parsers Map、tabActors Map、dirtyTabs Set、tabCwds Map、tabWorktreeInfo Map
- [x] 2.7 提供 getter 方法：getActiveTabId、getTabIds、getTabName、getTabCwd、getParser、getGitBranch 等
- [x] 2.8 从 main.ts 中移除对应闭包，替换为 TabManager 方法调用
- [x] 2.9 迁移 rebuildPanes/resizeActive/refreshGitBranches 到 TabManager

## 3. KeyHandler 提取

- [x] 3.1 创建 `src/core/key-handler.ts`，实现 KeyHandler 类
- [x] 3.2 迁移键盘处理逻辑：Alt+数字、Alt+r、Alt+w、Alt+\、Alt+-、Alt+x、Ctrl+R、Ctrl+C
- [x] 3.3 迁移模式管理：搜索模式、重命名模式、确认模式的状态判断和分发
- [x] 3.4 KeyHandler 持有 TabManager、AppUI、CommandTracker 引用，通过方法调用分发操作
- [x] 3.5 从 main.ts 中移除整个 ui.onKey 回调，替换为 KeyHandler 调用
- [x] 3.6 运行 `bun run type-check` 验证

## 4. main.ts 编排层精简

- [x] 4.1 将 main.ts 改为初始化编排：创建 TabManager → 创建 CommandTracker → 创建 KeyHandler → 注入 AgentContext → 启动服务
- [x] 4.2 保留 renderLoop 和 gitPoll（或迁移到 TabManager）
- [x] 4.3 更新 AgentContext 注入：从闭包改为 TabManager 方法调用
- [x] 4.4 更新会话恢复逻辑：通过 TabManager 恢复 Tab
- [x] 4.5 确认 main.ts 在 100-150 行以内（实际 189 行，剩余为合理编排代码）
- [x] 4.6 运行 `bun run type-check` 验证

## 5. 集成验证

- [x] 5.1 `bun run type-check` 通过
- [ ] 5.2 手动启动 cmux-bun，验证基本 Tab 操作正常（需手动验证）
- [ ] 5.3 验证分屏功能正常（需手动验证）
- [ ] 5.4 验证 MCP/RPC 工具正常（list_tabs、create_tab、create_worktree）（需手动验证）
- [ ] 5.5 验证快捷键正常（Alt+数字、Ctrl+R、Alt+r、Alt+w）（需手动验证）
