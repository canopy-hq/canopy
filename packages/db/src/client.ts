import { drizzle } from "drizzle-orm/sqlite-proxy";

import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleDb | null = null;

// Lazy-initialized from initDb() — call before using any collection
export function getDb(): DrizzleDb {
  if (!_db) throw new Error("Database not initialized — call initDb() first");
  return _db;
}

export async function initDb(dbPath: string): Promise<void> {
  // Lazy import so the module can load in non-Tauri contexts (tests, storybook)
  const { default: Database } = await import("@tauri-apps/plugin-sql");
  const sqlite = await Database.load(dbPath);

  _db = drizzle(
    async (sql, params, method) => {
      try {
        if (method === "run") {
          await sqlite.execute(sql, params as unknown[]);
          return { rows: [] };
        }
        const rows = await sqlite.select<Record<string, unknown>>(sql, params as unknown[]);
        if (method === "get") {
          return { rows: rows[0] ? Object.values(rows[0]) : [] };
        }
        return {
          rows: (rows as unknown as Record<string, unknown>[]).map((row) => Object.values(row)),
        };
      } catch (e) {
        console.error("[db] query error:", e, { sql, params });
        throw e;
      }
    },
    { schema },
  );
}
