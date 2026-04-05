

import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
const sqlite = new Database(process.env.DB_FILE_NAME!);
export const db = drizzle({ client: sqlite });

export function runMigrations() {
  migrate(db, { migrationsFolder: "./drizzle" });
}

