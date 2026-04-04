import { sql } from 'drizzle-orm';

import { getDb } from './client';
import { settings, workspaces, tabs, sessions } from './schema';

/**
 * Run all migrations against the already-initialized SQLite database.
 * Uses CREATE TABLE IF NOT EXISTS — safe to call on every app startup.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();

  // Use raw SQL for table creation so we don't rely on drizzle-kit at runtime
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      branches TEXT NOT NULL DEFAULT '[]',
      worktrees TEXT NOT NULL DEFAULT '[]',
      expanded INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_path ON workspaces(path)
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT 'Terminal 1',
      label_is_manual INTEGER NOT NULL DEFAULT 0,
      workspace_item_id TEXT NOT NULL DEFAULT 'default',
      pane_root TEXT NOT NULL,
      focused_pane_id TEXT,
      position INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Idempotent column migration for existing databases — try/catch because
  // SQLite has no ALTER TABLE ADD COLUMN IF NOT EXISTS syntax.
  try {
    await db.run(sql`ALTER TABLE tabs ADD COLUMN label_is_manual INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      pane_id TEXT NOT NULL,
      tab_id TEXT NOT NULL,
      workspace_id TEXT,
      cwd TEXT NOT NULL,
      shell TEXT NOT NULL
    )
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Silence unused import warnings — these are used by collections
  void workspaces;
  void tabs;
  void sessions;
  void settings;
}
