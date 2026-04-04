# Frontend Conventions

Styling and component conventions for `apps/desktop/`.

## Stack

- **Tailwind CSS v4** via `@tailwindcss/vite` — no config file, all theme tokens in `@theme {}` block in `src/index.css`
- **tailwind-variants** (`tv()`) — component variant logic
- **tailwindcss-react-aria-components** — data-attribute variant support for React ARIA components
- **react-aria-components** — headless accessible UI primitives

## Rules

### 1. Tailwind-first — minimize `style={{}}`

Use utility classes as the default. `style={{}}` has two accepted uses:

**a) CSS variable injection** — passing a dynamic JS value into a Tailwind class via a CSS variable:

```tsx
// Pass a dynamic size prop into Tailwind via CSS variable
<span
  className="size-(--dot-size)"
  style={{ '--dot-size': `${size}px` } as React.CSSProperties}
/>

// Truly dynamic JS expression with no Tailwind equivalent
<div style={{ flex: `${ratio} 1 0%` }} />
```

**b) Vendor-prefixed properties and unrepresentable CSS** — properties Tailwind doesn't cover:

```tsx
// webkit prefix (no Tailwind equivalent)
<div style={{ WebkitBackdropFilter: 'blur(12px)' }} />

// Dynamic multi-stop mask gradient computed in JS
<div style={{ WebkitMaskImage: maskImage }} />
```

Everything else must use Tailwind classes. In particular, **never** reference a CSS var via `style=`:

```tsx
// BAD
<div style={{ backgroundColor: 'var(--bg-primary)' }} />
<div style={{ color: 'var(--agent-running)' }} />

// BAD — old arbitrary-value syntax
<div className="bg-[var(--bg-primary)]" />

// GOOD — Tailwind semantic class (token in @theme)
<div className="bg-bg-primary" />

// GOOD — Tailwind v4 CSS variable shorthand (token not in @theme)
<div className="bg-(--agent-running) text-(--agent-waiting)" />
```

### 2. Component variants with `tv()`

Use `tailwind-variants` for all component variant logic. Never use template literal ternaries for conditional classes.

```tsx
import { tv } from 'tailwind-variants';

const tab = tv({
  base: 'group flex h-full cursor-pointer items-center gap-1.5 border-t-2 px-3 transition-colors',
  variants: {
    active: {
      true: 'border-t-accent bg-tab-active-bg text-text-primary',
      false: 'border-t-transparent bg-tab-inactive-bg text-text-muted hover:bg-bg-secondary',
    },
    agentWaiting: { true: 'bg-(--agent-waiting-glow)' },
  },
  defaultVariants: { active: false, agentWaiting: false },
});

// Usage
<button className={tab({ active: isActive, agentWaiting: agentStatus === 'waiting' })} />;
```

For components with multiple styled sub-elements, use **slots**:

```tsx
const alert = tv({
  slots: { root: 'rounded-lg border p-4', title: 'text-sm font-semibold', message: 'text-xs' },
  variants: {
    severity: {
      error: { root: 'border-destructive bg-destructive/10', title: 'text-destructive' },
      success: { root: 'border-accent bg-accent/10', title: 'text-accent' },
    },
  },
});

const { root, title, message } = alert({ severity: 'error' });

<div className={root()}>
  <h3 className={title()}>Error</h3>
  <p className={message()}>Something went wrong.</p>
</div>;
```

### 3. React ARIA data-attribute variants

With the `tailwindcss-react-aria-components` plugin, use data-attribute variants instead of render-prop `className` functions:

```tsx
// BAD — render-prop className
<TreeItem className={({ isSelected }) =>
  `cursor-pointer ${isSelected ? 'bg-accent/10' : 'hover:bg-bg-tertiary'}`
} />

// GOOD — data-attribute variants
<TreeItem className="cursor-pointer data-[selected]:bg-accent/10 hover:bg-bg-tertiary" />
```

Available data-attribute variants from the plugin:

- `data-[selected]:` — selected state
- `data-[focused]:` — keyboard focus
- `data-[hovered]:` — hover state
- `data-[pressed]:` — active/pressed
- `data-[disabled]:` — disabled state
- `data-[focus-visible]:` — keyboard-only focus ring
- `data-[dragging]:` — during drag
- `data-[open]:` — expanded/open state
- `data-[entering]:` / `data-[exiting]:` — animation states

### 4. Standard Tailwind variants

Use built-in Tailwind variants for interactive and structural patterns:

- `group-*` / `peer-*` — parent/sibling-driven styles
- `has-[*]:` — container queries based on child state
- `forced-colors:` — Windows High Contrast mode
- `hover:`, `focus-visible:`, `active:` — standard pseudo-states

### 5. CSS custom properties

Custom properties are for **theming tokens only**, defined in the `@theme {}` block of `index.css`. Each theme (`[data-theme="obsidian"]`, etc.) sets the raw `--var` values, and `@theme` maps them to Tailwind color utilities.

- Use Tailwind semantic classes (`bg-bg-primary`, `text-text-muted`, `border-border`) for tokens in `@theme`
- Use Tailwind v4 shorthand `property-(--var)` for theme vars not yet in `@theme` (e.g. `bg-(--agent-running)`)
- If a CSS variable is used in 3+ places and not yet in `@theme`, add it to the `@theme` block

### 6. Arbitrary values

Tailwind's `[]` syntax is fine for one-off values: `text-[13px]`, `w-[480px]`, `rounded-[10px]`.

In Tailwind v4, `z-<integer>` works for any integer natively (`z-50`, `z-100`, etc.) — no config needed.

If a value repeats across 3+ components, add it to the `@theme {}` block instead.

### 7. Custom utilities

Add reusable vendor-prefixed or non-standard CSS patterns as `@utility` in `index.css` rather than repeating inline styles:

```css
/* index.css */
@utility scrollbar-none {
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}
```

```tsx
// Usage
<div className="scrollbar-none overflow-y-auto" />
```

### 8. SVG attributes

`stroke` and `fill` on `<svg>` / `<path>` elements are SVG attributes, not CSS — `className` cannot be used on them. CSS var references via the attribute value are acceptable:

```tsx
// ACCEPTABLE — SVG attribute (not inline CSS)
<svg stroke={isActive ? 'var(--accent)' : 'var(--text-muted)'} />
```

Prefer `stroke="currentColor"` + a `text-*` class on the parent when the stroke is static.

### 9. Type-safe variant props

Use `VariantProps` to extract variant types for component props:

```tsx
import { tv, type VariantProps } from 'tailwind-variants';

const statusDot = tv({
  base: 'inline-block shrink-0 rounded-full size-(--dot-size)',
  variants: {
    status: {
      running: 'bg-(--agent-running) animate-[pulse-slow_2s_ease-in-out_infinite]',
      waiting: 'bg-(--agent-waiting) animate-[breathe_2.5s_ease-in-out_infinite]',
      idle: 'bg-(--agent-idle)',
    },
  },
});

type StatusDotVariants = VariantProps<typeof statusDot>;

interface StatusDotProps extends StatusDotVariants {
  size?: number;
}
```
