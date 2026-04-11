# @canopy/db

SQLite-backed persistent state + in-memory collections for the Canopy app. Built on TanStack DB (optimistic, reactive) + Drizzle ORM (type-safe SQLite via `@tauri-apps/plugin-sql`).

## Initialization order — critical

Must run in this exact order before rendering:

```ts
await initDb(dbPath); // 1. connect SQLite
await runMigrations(); // 2. create/migrate tables
await hydrateCollections(); // 3. load state into memory (settings first, then parallel)
```

Never skip or reorder. Hydration reads settings first (theme, sidebar width) before restoring UI state.

## Collections

All collections are **module-level singletons** initialized during hydration. Access them via their getter:

| Getter                   | Persisted | Description                                  |
| ------------------------ | --------- | -------------------------------------------- |
| `getProjectCollection()` | ✅        | Git projects, branches, worktrees            |
| `getTabCollection()`     | ✅        | Tabs with pane trees                         |
| `getSessionCollection()` | ✅        | PTY sessions (paneId → shell process)        |
| `getSettingCollection()` | ✅        | Key-value settings (JSON-encoded values)     |
| `uiCollection`           | partial   | Navigation state — see dual-write rule below |
| `agentCollection`        | ❌        | Running agents — ephemeral, in-memory only   |

**Reactive read** (inside components):

```ts
const projects = useLiveQuery(() => getProjectCollection());
```

**Imperative read** (inside action functions — no re-render triggered):

```ts
const ui = getUiState();
const tabs = getTabCollection().getAll();
```

## Dual-write rule for UI state

Navigation state (`activeTabId`, `sidebarVisible`, `selectedItemId`, `sidebarWidth`, `contextActiveTabIds`) must be written to **both** collections on every change:

```ts
// uiCollection — in-memory, reactive
// settingCollection — persisted, survives restart
uiCollection.update(...);
setSetting('activeTabId', value);
```

Omitting the settingCollection write loses state on restart.

## Schema

```
projects   id, path (unique), name, branches (JSON), worktrees (JSON), expanded, position, color
tabs       id, label, labelIsManual, projectItemId, paneRoot (JSON), focusedPaneId, position
sessions   id, paneId, tabId, projectId, cwd, shell
settings   key (PK), value (TEXT/JSON)
```

**`projectItemId` composite keys:**

- `{proj.id}` — project root
- `{proj.id}-branch-{name}` — branch
- `{proj.id}-wt-{name}` — worktree

## Pane tree

Tabs contain a recursive pane tree stored as JSON:

```ts
type PaneNode =
  | { type: 'leaf'; id: string; ptyId: number | null }
  | { type: 'branch'; id: string; direction: 'h' | 'v'; ratios: number[]; children: PaneNode[] };
```

Supports arbitrary nesting for horizontal/vertical splits.

## Settings helpers

```ts
getSetting(settings, 'key', fallback); // typed read with fallback
setSetting('key', value); // upsert — writes to DB
```

## Migrations

`runMigrations()` is idempotent — safe to run multiple times. Uses `PRAGMA table_info` checks before `ALTER TABLE` to avoid duplicate-column errors.
