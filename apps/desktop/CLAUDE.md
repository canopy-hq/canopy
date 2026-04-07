# Frontend — apps/desktop

React 19 + TypeScript frontend running inside Tauri v2. This is a native macOS app, not a browser — certain browser APIs may be absent or behave differently.

## UI Stack

| Layer           | Library                                   | Role                                                                 |
| --------------- | ----------------------------------------- | -------------------------------------------------------------------- |
| Styling         | **Tailwind CSS v4** (`@tailwindcss/vite`) | No config file — tokens in `src/index.css` `@theme {}`               |
| Variants        | **tailwind-variants** (`tv()`)            | All component variant logic                                          |
| Components      | **react-aria-components**                 | Headless accessible primitives (Button, Menu, Dialog…)               |
| ARIA + Tailwind | **tailwindcss-react-aria-components**     | `data-[selected]:`, `data-[focused]:` variants                       |
| Routing         | **TanStack Router** (file-based)          | Routes in `src/routes/`                                              |
| State           | **TanStack DB** + `useLiveQuery`          | In-memory collections, write-through to SQLite                       |
| Shared UI       | **`@superagent/ui`**                      | Primitives shared with command-palette — see `packages/ui/CLAUDE.md` |

## Tailwind v4 rules

**Tailwind-first.** Use `style={{}}` only for: (1) injecting dynamic JS values via CSS variables, (2) vendor-prefixed properties Tailwind doesn't cover.

```tsx
// BAD — never reference a CSS var via style=
<div style={{ color: 'var(--accent)' }} />

// BAD — old arbitrary-value syntax
<div className="bg-[var(--bg-primary)]" />

// GOOD — semantic Tailwind class (token in @theme)
<div className="bg-bg-primary text-text-muted" />

// GOOD — v4 shorthand for vars not in @theme
<div className="bg-(--agent-running)" />
```

**Token reference:**

| Role         | Tailwind class                                                                      |
| ------------ | ----------------------------------------------------------------------------------- |
| Background   | `bg-bg-primary` / `bg-bg-secondary` / `bg-bg-tertiary`                              |
| Text         | `text-text-primary` / `text-text-secondary` / `text-text-muted` / `text-text-faint` |
| Border       | `border-border` / `border-border-focus`                                             |
| Accent       | `text-accent` / `bg-accent` / `border-accent`                                       |
| Destructive  | `text-destructive` / `bg-destructive`                                               |
| Agent states | `bg-(--agent-running)` / `bg-(--agent-waiting)` / `bg-(--agent-idle)`               |

If a CSS variable is used in 3+ places and isn't in `@theme`, add it.

## Component variants with `tv()`

Never use template-literal ternaries for conditional classes — always `tv()`:

```tsx
import { tv, type VariantProps } from 'tailwind-variants';

const button = tv({
  base: 'inline-flex items-center rounded-md font-medium',
  variants: {
    variant: {
      primary: 'bg-accent text-white hover:opacity-90',
      ghost: 'bg-transparent text-text-muted hover:bg-bg-tertiary',
    },
  },
});

export type ButtonVariants = VariantProps<typeof button>;
```

Use **slots** for components with multiple styled sub-elements.

## React ARIA data-attribute variants

With the `tailwindcss-react-aria-components` plugin, use data-attribute variants — never render-prop `className`:

```tsx
// BAD
<MenuItem className={({ isSelected }) => isSelected ? 'bg-accent/10' : ''} />

// GOOD
<MenuItem className="data-[selected]:bg-accent/10 data-[focused]:bg-bg-tertiary" />
```

Key variants: `data-[selected]:`, `data-[focused]:`, `data-[pressed]:`, `data-[disabled]:`, `data-[hovered]:`, `data-[open]:`.

## SVG stroke/fill

`stroke` and `fill` are SVG attributes, not CSS — `className` doesn't apply:

```tsx
// Acceptable — SVG attribute
<FolderGit2 stroke={isSelected ? 'var(--accent)' : 'var(--text-muted)'} />

// Preferred when static — use currentColor + text class on parent
<span className="text-accent"><FolderGit2 /></span>
```

## Component patterns

- **`React.memo` + custom comparators** for every leaf component in lists/trees. The sidebar has 500+ nodes. Compare only the props that actually affect rendering.
- **`useCallback`** for any callback passed to a memoized child.
- **No allocations in TanStack DB selectors.** Never use `filter()`, `map()`, or object spread inside selectors — creates new references every render, causing infinite re-renders.
- **`createPortal(document.body)`** for modals and command palettes.
- **`data-tauri-drag-region`** on header elements for native window dragging.
- **Function components only** — no class components.

## State management

Collections are **module-level singletons**:

```ts
// Reactive read (inside components)
const projects = useLiveQuery(() => getProjectCollection());

// Imperative read (inside action functions — no re-render)
const ui = getUiState();
```

**Dual-write UI state:** navigation state (`activeTabId`, `sidebarVisible`, …) must be written to both `uiCollection` (in-memory) and `settingCollection` (persisted) on every change.

**`projectItemId` composite keys:** `proj.id` → repo root, `proj.id-branch-{name}` → branch, `proj.id-wt-{name}` → worktree.

## Shared UI package (`@superagent/ui`)

Components shared between `apps/desktop` and `packages/command-palette` live in `packages/ui`. Import from there, don't duplicate:

```ts
import { Kbd } from '@superagent/ui'; // base component
import { Kbd } from '../../components/ui'; // desktop wrapper (default variant)
```

See `packages/ui/CLAUDE.md` for what's available and when to add a component.

## Performance — scale target: 40 workspaces × 50 branches = 2000 items

- **Polling is visibility-gated.** Pause when sidebar hidden (`sidebarVisible`) AND window hidden (`document.visibilityState`).
- **Adaptive intervals.** 3 s → 10 s (5 unchanged polls) → 15 s (10 unchanged). Reset on change.
- **Scope to visible data.** Only poll expanded workspaces; carry forward stale data for collapsed ones.
- **Shallow comparison.** Never `JSON.stringify` for equality — use shallow key/value comparison or refs.
- Profile the "40 workspaces expanded" scenario before shipping any polling feature.

## Tauri plugin versioning

Always pin Tauri plugins to a specific minor version with a caret — never use a bare major (`"^2"`):

```json
// BAD
"@tauri-apps/plugin-updater": "^2"

// GOOD
"@tauri-apps/plugin-updater": "^2.10.1"
```

This applies to both JS (`package.json`) and Rust (`Cargo.toml`). Tauri plugin minor releases can introduce breaking changes in the JS/Rust bridge, and a bare `^2` would silently pull them in.

## Testing

- **Vitest + React Testing Library.** Mock Tauri modules with `vi.mock('@tauri-apps/api/...')`.
- Pure logic (pane-tree-ops, tab-actions) needs no mocks.
- Mock `useCollections` hooks when a component reads reactive state.
- Run: `cd apps/desktop && bun run test`
