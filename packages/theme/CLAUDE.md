# @superagent/theme

Single source of truth for all design tokens. Consumed by `apps/desktop` via `@import '@superagent/theme'` in `src/index.css`.

## Architecture

```
@theme {}          → Tailwind v4 token registration (generates utility classes)
:root              → Global constants + computed tokens (same across all themes)
[data-theme='*']   → Per-theme primitive overrides (8 dark themes)
```

**Computed tokens** (`--selected`, `--input`, `--placeholder`) are defined once in `:root` and auto-adapt to each theme because they reference per-theme primitives (`--accent`, `--base`, `--fg-muted`).

**Global constants** (`--hover`, `--claude`, `--danger`, `--ahead`, `--behind`, all `--agent-*`) are identical across all dark themes — do not redefine them in per-theme blocks.

## Token reference

| CSS var | Tailwind class | Role |
|---------|----------------|------|
| `--base` | `bg-base` | App canvas — darkest background |
| `--raised` | `bg-raised` | Raised surfaces: sidebar, header, tab bar |
| `--surface` | `bg-surface` | Floating surfaces: menus, popovers, tooltips, dialogs |
| `--hover` | `bg-hover` | Subtle hover for dense list/tree rows (rgba white 10%) |
| `--selected` | `bg-selected` | Accent-tinted selected state for sidebar tree items |
| `--selected-hover` | `bg-selected-hover` | Selected + hovered |
| `--input` | `bg-input` | Form input field backgrounds |
| `--placeholder` | `text-placeholder` | Input/textarea placeholder text |
| `--fg` | `text-fg` | Primary text — high contrast |
| `--fg-dim` | `text-fg-dim` | Secondary text |
| `--fg-muted` | `text-fg-muted` | Muted text — labels, metadata |
| `--fg-faint` | `text-fg-faint` | Faintest text — hints, decorative |
| `--edge` | `border-edge` | Default border / divider |
| `--focus` | `border-focus`, `ring-focus` | Focus ring color (= accent in most themes) |
| `--accent` | `bg-accent`, `text-accent` | Theme accent color (varies per theme) |
| `--danger` | `bg-danger`, `text-danger` | Destructive actions + error states |
| `--branch` | `text-branch` | Git branch icon color |
| `--worktree` | `text-worktree` | Git worktree icon color |
| `--claude` | `text-claude` | Claude Code brand color (#da7756) |
| `--ahead` | `text-ahead` | Git commits ahead (green) |
| `--behind` | `text-behind` | Git commits behind (red) |

## Opacity modifiers

Use Tailwind's `/N` modifier directly on semantic tokens for contextual variants:

| Class | Usage |
|-------|-------|
| `hover:bg-hover` | Subtle hover for sidebar tree rows, action rows |
| `hover:bg-surface/50` | Visible hover for menu items, palette rows, settings nav |
| `hover:bg-surface` | Full hover for ghost buttons, context menu items |
| `bg-surface/60` | Count badge backgrounds |
| `bg-raised/85` | Glass modal backgrounds (pair with `backdrop-blur`) |
| `bg-accent/10` | Selected tabs, chips, section buttons |
| `border-edge/20` | Very subtle dividers (section separators) |
| `border-edge/40` | Input borders, secondary separators |
| `border-edge/60` | Dialog borders, component borders |
| `text-danger/80` | Error messages, destructive ghost button text |
| `text-fg-muted/60` → `text-placeholder` | Placeholder text (use the token) |

## Hover system — two intentional intensities

- **Dense list/tree items** (sidebar branches, worktrees, action rows): `hover:bg-hover`
  → rgba(255,255,255,0.10) additive — barely visible, appropriate for 2000-item lists
- **Menu/palette items** (context menus, command palette, settings nav): `hover:bg-surface/50`
  → 50% of surface color — clearly visible for cursor navigation
- **Ghost buttons, full-size interactive surfaces**: `hover:bg-surface`
  → Full surface opacity

## Contrast metrics (verified)

All themes were designed to meet:
- `fg` on `base`: ≥ 14.5:1 (WCAG AAA)
- `fg-dim` on `base`: ≥ 8.7:1 (WCAG AA)
- `edge`/`surface` ratio: ≥ 1.30:1 (hairline border visibility)
- Background level steps: ≥ 12 avg RGB points between `base`→`raised` and `raised`→`surface`

## Adding a new theme

1. Add `[data-theme='<name>']` block in `src/index.css`
2. Define all primitive vars:
   ```css
   --base, --raised, --surface, --edge, --focus,
   --fg, --fg-dim, --fg-muted, --fg-faint,
   --accent, --branch, --worktree, --splitter-hover,
   --agent-running, --agent-waiting, --agent-idle,
   --agent-running-pulse, --agent-waiting-glow,
   --agent-waiting-border, --agent-waiting-inset
   ```
3. Do **not** redefine: `--hover`, `--claude`, `--danger`, `--ahead`, `--behind`, `--selected`, `--selected-hover`, `--input`, `--placeholder`, `--agent-*` — these are global
4. Verify contrast: `base`→`raised` avg RGB diff ≥ 12, `fg`/`base` ≥ 14:1
5. Add the theme name to `apps/desktop/src/components/settings/AppearanceSection.tsx`

## Not exposed as Tailwind tokens (use CSS var shorthand)

Agent status vars are used only in specific components via `style=` or Tailwind shorthand `bg-(--agent-*)`:
- `--agent-running`, `--agent-waiting`, `--agent-idle` — status dot colors
- `--agent-running-pulse` — running animation color
- `--agent-waiting-glow`, `--agent-waiting-border`, `--agent-waiting-inset` — waiting border glow
- `--splitter-hover` — used only in `Splitter.tsx` via `bg-(--splitter-hover)`
