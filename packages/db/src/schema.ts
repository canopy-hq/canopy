import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  path: text('path').notNull().unique(),
  name: text('name').notNull(),
  // JSON: BranchInfo[]
  branches: text('branches').notNull().default('[]'),
  // JSON: WorktreeInfo[]
  worktrees: text('worktrees').notNull().default('[]'),
  expanded: integer('expanded', { mode: 'boolean' }).notNull().default(true),
  position: integer('position').notNull().default(0),
  color: text('color'),
  invalid: integer('invalid', { mode: 'boolean' }).notNull().default(false),
});

export const tabs = sqliteTable('tabs', {
  id: text('id').primaryKey(),
  label: text('label').notNull().default('Terminal 1'),
  labelIsManual: integer('label_is_manual', { mode: 'boolean' }).notNull().default(false),
  projectItemId: text('project_item_id').notNull().default('default'),
  // JSON: PaneNode (serialized recursive tree)
  paneRoot: text('pane_root').notNull(),
  focusedPaneId: text('focused_pane_id'),
  icon: text('icon'),
  position: integer('position').notNull().default(0),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  paneId: text('pane_id').notNull(),
  tabId: text('tab_id').notNull(),
  projectId: text('project_id'),
  cwd: text('cwd').notNull(),
  shell: text('shell').notNull(),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  // JSON-encoded value for flexibility
  value: text('value').notNull(),
});
