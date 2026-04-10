import { sql } from 'drizzle-orm';

import { getDb } from './client';
import { settings, projects, tabs, sessions, groups } from './schema';

/**
 * Run all migrations against the already-initialized SQLite database.
 * Uses CREATE TABLE IF NOT EXISTS — safe to call on every app startup.
 */
export async function runMigrations(): Promise<void> {
  const db = getDb();

  // Use raw SQL for table creation so we don't rely on drizzle-kit at runtime
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      name TEXT NOT NULL,
      branches TEXT NOT NULL DEFAULT '[]',
      worktrees TEXT NOT NULL DEFAULT '[]',
      expanded INTEGER NOT NULL DEFAULT 1,
      position INTEGER NOT NULL DEFAULT 0,
      color TEXT,
      invalid INTEGER NOT NULL DEFAULT 0
    )
  `);

  await db.run(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path)
  `);

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS tabs (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT 'Terminal 1',
      label_is_manual INTEGER NOT NULL DEFAULT 0,
      project_item_id TEXT NOT NULL DEFAULT 'default',
      pane_root TEXT NOT NULL,
      focused_pane_id TEXT,
      icon TEXT,
      position INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Idempotent column migrations — check via PRAGMA before ALTER to avoid Tauri SQL plugin logging the duplicate-column error.
  // Note: db.get via the sqlite-proxy driver returns a positional array, so we access [0] not .cnt.
  const tabCols = await db.get<[number]>(
    sql`SELECT COUNT(*) FROM pragma_table_info('tabs') WHERE name = 'label_is_manual'`,
  );
  if (!tabCols || !tabCols[0]) {
    await db.run(sql`ALTER TABLE tabs ADD COLUMN label_is_manual INTEGER NOT NULL DEFAULT 0`);
  }

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      pane_id TEXT NOT NULL,
      tab_id TEXT NOT NULL,
      project_id TEXT,
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

  // ── Rename workspaces → projects (idempotent) ─────────────────────────────
  // Check if the old table still exists before migrating.
  const wsTable = await db.get<{ cnt: number }>(
    sql`SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='workspaces'`,
  );
  if (wsTable && wsTable.cnt > 0) {
    await db.run(sql`ALTER TABLE workspaces RENAME TO projects`);
    await db.run(sql`DROP INDEX IF EXISTS idx_workspaces_path`);
    await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_path ON projects(path)`);
  }

  // Add color column to projects if missing (pre-rename installs had it on workspaces).
  const projCols = await db.get<[number]>(
    sql`SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = 'color'`,
  );
  if (!projCols || !projCols[0]) {
    await db.run(sql`ALTER TABLE projects ADD COLUMN color TEXT`);
  }

  // Rename workspace_item_id → project_item_id on tabs (idempotent).
  const tabItemCol = await db.get<[number]>(
    sql`SELECT COUNT(*) FROM pragma_table_info('tabs') WHERE name = 'workspace_item_id'`,
  );
  if (tabItemCol && tabItemCol[0]) {
    await db.run(sql`ALTER TABLE tabs RENAME COLUMN workspace_item_id TO project_item_id`);
  }

  // Rename workspace_id → project_id on sessions (idempotent).
  const sessWsCol = await db.get<[number]>(
    sql`SELECT COUNT(*) FROM pragma_table_info('sessions') WHERE name = 'workspace_id'`,
  );
  if (sessWsCol && sessWsCol[0]) {
    await db.run(sql`ALTER TABLE sessions RENAME COLUMN workspace_id TO project_id`);
  }

  // Add icon column to tabs if missing.
  const tabIconCol = await db.get<[number]>(
    sql`SELECT COUNT(*) FROM pragma_table_info('tabs') WHERE name = 'icon'`,
  );
  if (!tabIconCol || !tabIconCol[0]) {
    await db.run(sql`ALTER TABLE tabs ADD COLUMN icon TEXT`);
  }

  // Add invalid column to projects if missing.
  const projInvalidCol = await db.get<[number]>(
    sql`SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = 'invalid'`,
  );
  if (!projInvalidCol || !projInvalidCol[0]) {
    await db.run(sql`ALTER TABLE projects ADD COLUMN invalid INTEGER NOT NULL DEFAULT 0`);
  }

  // ── Groups table ─────────────────────────────────────────────────────────────
  await db.run(sql`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      collapsed INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Add group_id column to projects if missing.
  const projGroupCol = await db.get<[number]>(
    sql`SELECT COUNT(*) FROM pragma_table_info('projects') WHERE name = 'group_id'`,
  );
  if (!projGroupCol || !projGroupCol[0]) {
    await db.run(sql`ALTER TABLE projects ADD COLUMN group_id TEXT`);
  }

  // Silence unused import warnings — these are used by collections
  void projects;
  void tabs;
  void sessions;
  void settings;
  void groups;
}
