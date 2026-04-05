import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2"; // 推荐使用 cuid2 作为唯一 ID

export const tabs = sqliteTable("tabs", {
  id: text("id").primaryKey().$defaultFn(() => createId()),
  name: text("name").notNull(),
  cwd: text("cwd").notNull(),
  shell: text("shell").default("cmd.exe"),
  order: integer("order").notNull(),
  isActive: integer("is_active", { mode: "boolean" }).default(false),
});