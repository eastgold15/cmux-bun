import { db } from "./connection.js";
import { commandHistory } from "./schema.js";
import { desc, like, eq } from "drizzle-orm";

/** 插入一条命令记录，返回记录 id */
export function addCommand(tabId: string, command: string, cwd: string): string {
  const id = crypto.randomUUID();
  db.insert(commandHistory).values({
    id,
    tabId,
    command,
    cwd,
    startedAt: new Date(),
  }).run();
  return id;
}

/** 标记命令执行完毕 */
export function finishCommand(id: string, exitCode: number | null): void {
  db.update(commandHistory)
    .set({ finishedAt: new Date(), exitCode: exitCode ?? 0 })
    .where(eq(commandHistory.id, id))
    .run();
}

/** 搜索历史命令（LIKE 模糊匹配） */
export function searchCommands(query: string, limit = 20) {
  return db
    .select()
    .from(commandHistory)
    .where(like(commandHistory.command, `%${query}%`))
    .orderBy(desc(commandHistory.startedAt))
    .limit(limit)
    .all();
}

/** 获取最近 N 条命令 */
export function getRecentCommands(limit = 50) {
  return db
    .select()
    .from(commandHistory)
    .orderBy(desc(commandHistory.startedAt))
    .limit(limit)
    .all();
}
