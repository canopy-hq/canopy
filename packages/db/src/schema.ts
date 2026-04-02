import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('workspaces', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  name: text('name').notNull(),
  // JSON: BranchInfo[]
  branches: text('branches').notNull().default('[]'),
  // JSON: WorktreeInfo[]
  worktrees: text('worktrees').notNull().default('[]'),
  expanded: integer('expanded', { mode: 'boolean' }).notNull().default(true),
  position: integer('position').notNull().default(0),
});

export const tabs = sqliteTable('tabs', {
  id: text('id').primaryKey(),
  label: text('label').notNull().default('Terminal'),
  workspaceItemId: text('workspace_item_id').notNull().default('default'),
  // JSON: PaneNode (serialized recursive tree)
  paneRoot: text('pane_root').notNull(),
  focusedPaneId: text('focused_pane_id'),
  position: integer('position').notNull().default(0),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  paneId: text('pane_id').notNull(),
  tabId: text('tab_id').notNull(),
  workspaceId: text('workspace_id'),
  cwd: text('cwd').notNull(),
  shell: text('shell').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  // JSON-encoded value for flexibility
  value: text('value').notNull(),
});
