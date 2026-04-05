import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

function resolveDbPath(): string {
  // 1. 显式环境变量优先
  if (process.env.DB_FILE_NAME) return process.env.DB_FILE_NAME;

  const isWin = process.platform === "win32";
  const appName = "cmux";

  if (isWin) {
    // Windows: %APPDATA%/cmux/cmux.db
    const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appData, appName, "cmux.db");
  }

  // Unix: ~/.local/share/cmux/cmux.db
  const xdgData = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdgData, appName, "cmux.db");
}

const dbPath = resolveDbPath();
const dbDir = dirname(dbPath);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath);
export const db = drizzle({ client: sqlite });

export function runMigrations() {
  migrate(db, { migrationsFolder: "./drizzle" });
}

