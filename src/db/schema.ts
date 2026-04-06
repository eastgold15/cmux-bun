import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

import { createId } from "@paralleldrive/cuid2"; // 推荐使用 cuid2 作为唯一 ID

export const tabs = sqliteTable("tabs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  cwd: text("cwd").notNull(),
  shell: text("shell").default("cmd.exe"),
  order: integer("order").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(false),
  isWorktree: integer("is_worktree", { mode: "boolean" }).default(false),
});

// 布局持久化：存储分屏树结构
export const layouts = sqliteTable("layouts", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  // 树状结构：leaf 节点关联 tabId，split 节点存储方向和比例
  type: text("type", { enum: ["leaf", "split"] }).notNull(),
  tabId: text("tab_id"), // leaf 节点关联的 tab id
  direction: text("direction", { enum: ["horizontal", "vertical"] }), // split 节点方向
  ratio: real("ratio").default(0.5), // split 节点的分割比例
  parentId: text("parent_id"), // 父节点 id（自引用）
  order: integer("order").notNull().default(0), // 在父节点中的顺序
  sessionId: text("session_id").notNull().default("default"), // 会话 id
});

// 命令历史：记录用户在终端中执行的命令
export const commandHistory = sqliteTable("command_history", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  tabId: text("tab_id").notNull(),
  command: text("command").notNull(),
  cwd: text("cwd").notNull(),
  exitCode: integer("exit_code"),
  startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
}, (table) => [
  index("idx_command_history_command").on(table.command),
  index("idx_command_history_tab_id").on(table.tabId),
  index("idx_command_history_started_at").on(table.startedAt),
]);
