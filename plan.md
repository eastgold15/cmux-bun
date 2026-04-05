cmux-bun 下一步开发计划
Context
cmux-bun 目前已完成 MVP 基础架构：PTY 管理、ANSI 解析器（2D Grid Buffer）、OpenTUI UI 骨架（侧边栏 + 视窗 + 状态栏）、XState 状态机、SQLite 持久化、RPC 服务。程序可以运行，能创建多个 Tab、切换 Tab、恢复会话。

但作为终端复用器，还缺少最核心的功能——分屏，以及其他让日常使用更舒适的特性。

Phase 1: 分屏系统（最高优先级）
目标：在单个 Tab 内支持水平/垂直分屏，焦点切换。

1.1 合并布局引擎
存在两个重复实现：src/tui/layout.ts（有 getAdjacentLeaf、computeLayout）和 src/layout/layout-tree.ts（有 serializeLayout/deserializeLayout）。

文件：合并到 src/layout/layout-tree.ts，删除 src/tui/layout.ts
保留 src/tui/layout.ts 的 getAdjacentLeaf、computeLayout、节点带坐标的方式
保留 src/layout/layout-tree.ts 的序列化/反序列化
统一用 id 字段（与 PTY 实例 ID 一致）
1.2 重构 AppUI 支持多视窗
当前 AppUI 只有一个 viewport 和一个 terminalOutput，需要支持 N 个 pane。

文件：src/tui/app.ts（主要重构）
方案：每个 pane 是独立的 BoxRenderable（absolute 定位），坐标由布局树计算
新增数据结构：
paneContainer: BoxRenderable          // 视窗区域容器
panes: Map<string, { box, text }>     // 每个叶子节点一个 pane
focusedPaneId: string | null          // 当前焦点 pane
新增方法：
buildPanes(layoutRoot) — 根据 layout 树创建/定位所有 pane
focusPane(paneId) — 高亮焦点 pane 边框
updatePaneOutput(paneId, text) — 更新指定 pane 内容
getPaneSize(paneId) — 返回指定 pane 的 cols/rows
1.3 扩展 App 状态机
文件：src/state/app-machine.ts
Context 新增：layoutRoot、focusedPaneId
新增事件：SPLIT_PANE、CLOSE_PANE、FOCUS_PANE、FOCUS_PANE_DIRECTION、RESIZE_PANE
1.4 更新 main.ts 编排层
文件：src/main.ts
渲染循环：遍历所有可见 pane（而非仅 active tab），只更新 dirty 的
Resize：所有可见 pane 的 PTY 都要 resize
键盘路由：输入发给 focusedPane 的 PTY
快捷键：
Alt+\ — 水平分屏
Alt+- — 垂直分屏
Alt+方向键 — 切换焦点 pane
Alt+x — 关闭当前 pane
1.5 修复 AnsiParser.resize() 保留内容
文件：src/parser/ansi-parser.ts
当前 resize() 清空整个 grid，分屏时会丢失内容
改为保留新区域内的内容，只裁剪/扩展
1.6 布局持久化
文件：src/db/schema.ts、src/db/connection.ts
用 serializeLayout() 把布局树存为 JSON 字符串（简单方案，不需要 layouts 表的复杂自引用结构）
在 tabs 表旁加一个 session_layouts 表：{ session_id, layout_json, updated_at }
Phase 2: Git 分支显示 + Tab 管理
2.1 Git 分支检测
新建：src/utils/git.ts
用 Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"]) 在 tab 的 cwd 下执行
每 5 秒轮询一次，或在 tab 切换时检测
修改 src/tui/app.ts：sidebar tab item 显示分支名（绿色后缀）
2.2 Tab 重命名
快捷键 Alt+r 进入重命名模式
修改 app-machine.ts 添加 RENAME_TAB 事件
保存新名称到 DB
2.3 Tab 关闭确认
PTY 仍在运行时关闭 tab 弹出确认提示（overlay）
用 absolute 定位的 BoxRenderable 居中显示
Phase 3: 通知呼吸灯动画
新建：src/tui/animation.ts
根据 tab 状态驱动 pane 边框颜色动画：
idle — 静态边框
processing — 蓝色呼吸（~1.5s 周期）
attention — 红色快呼吸（~0.8s 周期）
用 Math.sin(Date.now() / frequency) 插值颜色
在渲染循环中更新
Phase 4: 命令历史 + 搜索
新建：src/db/history.ts、src/tui/history-overlay.ts
DB 表：command_history { id, tab_id, command, cwd, exit_code, started_at, finished_at }
拦截用户输入 + PTY 输出，检测命令边界（shell prompt 模式匹配）
Ctrl+R 打开搜索 overlay，LIKE 查询，Enter 插入选中命令
Phase 5: 环境预设
新建：src/db/presets.ts
DB 表：presets { id, name, layout_json }、preset_tabs { id, preset_id, name, cwd, shell, order }
侧边栏底部加"预设"入口，一键恢复工作区
Phase 6: 主题配置
新建：src/theme/loader.ts
支持加载 JSON 格式主题文件
theme.ts 从 as const 改为可变 store
活跃主题路径存 DB
Phase 7: AI Agent 集成
新建：src/agent/detector.ts、src/tui/prompt-bar.ts
检测 Claude Code / Aider 等 Agent 进程的输出模式
侧边栏显示 Agent 进度状态
可配置的 prompt 快捷注入按钮
Phase 8 & 9: 浮动浏览器 / 状态机调试窗口（低优先级）
WebView2 集成需要大量 Windows 特定代码，延后
XState inspector 作为 debug 工具，nice-to-have
关键风险
OpenTUI 多 pane 渲染：absolute 定位方案理论上可行，但 Yoga 布局重算性能需实测
AnsiParser resize 丢内容：必须在 Phase 1 解决，否则分屏体验极差
键盘路由复杂度：多 pane 下需要区分"终端输入"和"cmux 命令"，考虑引入 tmux 风格前缀键
验证方式
每个 Phase 完成后：

bun run src/main.ts 启动
手动测试对应功能（分屏/切换/关闭/恢复等）
bun run type-check 确保 TypeScript 无报错
关闭后重新打开，验证持久化