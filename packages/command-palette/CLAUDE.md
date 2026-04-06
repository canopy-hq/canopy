# @superagent/command-palette

Fuzzy-searchable command palette for navigating projects, tabs, PTY sessions, agents, and global actions. Used by `apps/desktop` as a full-screen modal.

## CommandItem model

```ts
interface CommandItem {
  id: string;
  label: string;
  category: 'project' | 'tab' | 'pty' | 'agent' | 'action' | 'global';
  icon?: CommandIcon;
  shortcut?: string; // displayed as <Kbd variant="menu">
  keywords?: string[]; // extra fuzzy-match tokens
  group?: string; // section header in results
  agentStatus?: DotStatus;
  action?: (ctx: CommandContext) => void | Promise<void>;
  children?: () => CommandItem[]; // lazy drill-down
  renderPanel?: (ctx: PanelContext) => ReactNode; // custom inline panel
}
```

**Two navigation modes:**

- `children()` — drill into a sub-list (breadcrumb nav, Backspace to go back)
- `renderPanel()` — render a custom React panel inline (e.g. branch picker, color picker)

## Main component

```tsx
<CommandMenu
  isOpen={open}
  onClose={() => setOpen(false)}
  context={commandContext} // { navigate, openTab, … }
  defaultPanelItem={item} // open directly into a panel
/>
```

`CommandMenu` is a React ARIA `Modal` + `Dialog`. It manages its own keyboard navigation and section cycling via `useCommandMenu`.

## State machine — `useCommandMenu`

```ts
const { state, dispatch, sections } = useCommandMenu(context, isOpen);

// Dispatch types
dispatch({ type: 'SET_QUERY', query });
dispatch({ type: 'SET_SECTION', section }); // 'root' | 'projects' | 'tabs' | 'pty' | 'agents'
dispatch({ type: 'DRILL_INTO', item });
dispatch({ type: 'BACK' });
dispatch({ type: 'SET_SELECTED', id });
dispatch({ type: 'OPEN_PANEL', item });
dispatch({ type: 'CLOSE_PANEL' });
```

Sections cycle on Tab. Backspace navigates up the drillStack. Fuzzy filtering runs synchronously on every keystroke — no debounce.

## Fuzzy search

```ts
fuzzyScore(query, target); // number — higher = better match
fuzzyFilter(items, query); // CommandItem[] sorted by score
```

Bonuses for consecutive characters and word boundary matches (`' - / _ . :`).

## Kbd in this package

All `<Kbd>` uses in command-palette **must** use `variant="menu"`:

```tsx
import { Kbd } from './ui'; // re-exports @superagent/ui Kbd with variant="menu" pre-wired

<Kbd>⌘K</Kbd>             // correct — smaller, border style
<Kbd variant="menu">⌘K</Kbd>  // also correct if importing directly from @superagent/ui
```

## UI utilities (`ui.tsx`)

```ts
focusLater(ref); // schedule focus in next rAF — avoids race on mount
useScrollSelectedIntoView(listRef, id); // scroll selected item into view on change
FooterBar / FooterHint / FooterSep; // footer layout for keyboard hints
SectionHeader; // section title pill
```
