# @canopy/ui

Shared UI primitives used across `apps/desktop` and `packages/command-palette`. Keeps component logic (split, variants, accessibility) in one place instead of duplicating it.

## Rule: when to add a component here

Add to `packages/ui` when a component or utility is:

- Used by **2+ packages** (desktop + command-palette, or future packages)
- **Logic-bearing** — contains non-trivial behaviour (key splitting, state, a11y)
- **Style-agnostic** — accepts a `variant` or `className` prop so each consumer can apply its own look

Don't add purely cosmetic wrappers — those belong in the consuming package.

## Current exports

### `Kbd`

Renders a keyboard shortcut. Splits modifier symbols (`⌘ ⌥ ⇧ ⌃`) into individual `<kbd>` elements automatically.

```tsx
import { Kbd } from '@canopy/ui';

<Kbd>⌘N</Kbd>          // renders ⌘ and N as separate <kbd> elements
<Kbd><ArrowUp /></Kbd>  // single <kbd> wrapping the icon
```

**Variants:**

| Variant             | Style                                          | Used in                                |
| ------------------- | ---------------------------------------------- | -------------------------------------- |
| `default` (default) | `bg-raised`, `text-xs`                         | `apps/desktop` tooltips, headers       |
| `menu`              | `bg-base border border-edge/60`, `text-[10px]` | command palette footer + palette hints |

```tsx
<Kbd variant="menu">⌘K</Kbd>
```

Each consuming package wraps `Kbd` with its default variant so call sites don't need to repeat it:

```ts
// apps/desktop/src/components/ui/Kbd.tsx
export { Kbd } from '@canopy/ui'; // variant="default" is implicit

// packages/command-palette/src/ui.tsx
export function Kbd({ children }) {
  return <KbdBase variant="menu">{children}</KbdBase>;
}
```

## Adding a new component

1. Create `packages/ui/src/MyComponent.tsx` — accept a `variant` or `className` prop for styling
2. Export from `packages/ui/src/index.ts`
3. Export type from `index.ts` if needed (`export type { MyVariant }`)
4. Add the consuming package's styled wrapper in that package
5. Update this file

## Package constraints

- No runtime React deps — only `peerDependencies`
- No Tailwind config — classes must work in the consumer's Tailwind context
- No side effects — pure component exports only
