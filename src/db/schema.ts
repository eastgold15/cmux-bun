import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

import { createId } from "@paralleldrive/cuid2"; // 推荐使用 cuid2 作为唯一 ID

export const tabs = sqliteTable("tabs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  cwd: text("cwd").notNull(),
  shell: text("shell").default("cmd.exe"),
  order: integer("order").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(false),
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
