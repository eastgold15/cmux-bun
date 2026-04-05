
import { defineConfig } from 'drizzle-kit';
const DB_FILE_NAME = process.env["DB_FILE_NAME"] || "cmux.db";
// 这里这个数据库的位置必须要先运行一次start, 然后看一下它的数据库在哪个位置，然后你再替换掉它
export const dbPath = `C:/Users/boer/AppData/Local/xianyuspy.electrobun.dev/dev/${DB_FILE_NAME}`;

export default defineConfig({
  out: './drizzle',
  schema: './src/bun/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: dbPath,
  },
});
