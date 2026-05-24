import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Singleton подключения. Адаптер Auth.js делает duck-typing на db (проверяет
// форму dialect), поэтому Proxy здесь не сработает — нужен реальный объект.
// dotenv-cli в package.json гарантирует, что DATABASE_URL виден на этом этапе.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Запусти через `pnpm dev` / `pnpm build` — " +
      "они подтягивают .env из корня монорепо через dotenv-cli.",
  );
}

const g = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
};
const sql = g.__pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") g.__pg = sql;

export const db = drizzle(sql, { schema });
export type DB = typeof db;
