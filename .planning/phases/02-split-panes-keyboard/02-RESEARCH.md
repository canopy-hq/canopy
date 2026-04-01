# Phase 2: Split Panes + Keyboard - Research

**Researched:** 2026-04-01
**Domain:** Recursive split pane layout, keyboard shortcut management, WebGL context budget, PTY lifecycle
**Confidence:** HIGH

## Summary

Phase 2 transforms the single-terminal app into a multi-pane workspace. The core data structure is a binary tree where leaf nodes are terminal panes and branch nodes encode split direction + flex ratios. This tree lives in Zustand and drives a recursive React renderer. The main technical challenges are: (1) WebGL context exhaustion (browsers cap at ~16 contexts, WebKit/Safari may be lower), (2) keyboard shortcut interception without breaking xterm.js passthrough, (3) PTY resize debouncing to avoid flooding the backend, and (4) adding a missing `close_pty` Tauri command for pane teardown.

No third-party split pane library (allotment, react-split-pane) supports recursive nesting out of the box with the control we need over WebGL lifecycle. Custom implementation is the right call -- the Warp engineering blog documents this exact pattern and it maps cleanly to our requirements.

**Primary recommendation:** Build a custom split pane tree with Zustand state, recursive `<SplitContainer>` renderer, CSS flexbox layout with draggable splitters, and a WebGL context budget that only attaches WebGL to visible panes (dispose on hide, re-attach on show).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TERM-02 | Split panes horizontally (Cmd+D) and vertically (Cmd+Shift+D) with recursive nesting | Binary tree data structure with branch/leaf nodes; split inserts new leaf or creates new branch |
| TERM-03 | Resize split panes by dragging visible splitter handles | Flex-ratio based sizing with pointer drag on splitter div; ratios stored in branch nodes |
| TERM-04 | Each pane displays floating header with CWD and agent status | Absolute-positioned overlay div per pane; CWD from PTY (OSC 7 or polling) |
| TERM-05 | Navigate between panes with Cmd+Option+arrow keys | Tree traversal: walk up to find matching-axis branch, then descend into adjacent child |
| TERM-06 | Close focused pane with Cmd+W | Remove leaf from tree, collapse single-child branches; new `close_pty` backend command needed |
| KEYS-01 | iTerm2-compatible default shortcuts | KeybindingRegistry with action map; Cmd+D, Cmd+Shift+D, Cmd+W, Cmd+Option+arrows |
| KEYS-02 | KeybindingRegistry intercepts keydown, matched shortcuts preventDefault + execute action | Global keydown listener on document, checked before xterm.js gets the event |
| KEYS-03 | Unmatched keys pass through to focused xterm.js terminal | Only preventDefault on matched shortcuts; xterm.js attachCustomKeyEventHandler for coordination |
</phase_requirements>

## Standard Stack

### Core (already installed -- no new deps needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 5.x | Pane tree state | Already in project; stores tree outside React for IPC access |
| @xterm/xterm | 6.0 | Terminal rendering | Already installed |
| @xterm/addon-webgl | 0.19.0 | GPU rendering | Already installed; must manage lifecycle per-pane |
| @xterm/addon-fit | 0.11.0 | Auto-resize | Already installed; call fit() on every pane resize |
| react-aria-components | 1.16.0 | Accessible splitter handles | Already installed; has no split pane primitive but FocusScope useful |

### No New Dependencies

This phase requires zero new npm or Cargo dependencies. Everything is built with existing stack:
- Split pane tree: custom Zustand store + recursive React components
- Splitter handles: plain div with pointer events + CSS cursor
- Keyboard registry: vanilla JS keydown listener
- WebGL budget: manual addon.dispose() / new WebglAddon() lifecycle

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom split pane | allotment 1.20.5 | allotment doesn't support recursive nesting natively; would need to hack around it; adds 30KB for something we can build in ~200 lines |
| Custom split pane | react-split-pane | Unmaintained (last publish 2020); React 19 compat unknown |
| Custom keyboard registry | tauri-plugin-global-shortcut | Global shortcuts fire even when app unfocused; we need window-scoped with xterm passthrough |

## Architecture Patterns

### Pane Tree Data Structure

```typescript
// The core data model
type PaneId = string; // nanoid or crypto.randomUUID()

type SplitDirection = 'horizontal' | 'vertical';

interface LeafNode {
  type: 'leaf';
  id: PaneId;
  ptyId: number;
}

interface BranchNode {
  type: 'branch';
  id: string;
  direction: SplitDirection;
  ratios: number[]; // e.g. [0.5, 0.5], always sum to 1.0
  children: PaneNode[];
}

type PaneNode = LeafNode | BranchNode;
```

Source: Warp engineering blog on terminal split pane trees.

### Split Algorithm

When user splits pane X in direction D:
1. Find leaf node X via DFS
2. If parent branch has same direction D: insert new leaf next to X, redistribute ratios evenly
3. If parent branch has different direction (or X is root): replace X with new branch(direction=D, children=[X, newLeaf], ratios=[0.5, 0.5])

### Close Algorithm

When user closes pane X:
1. Find and remove leaf X from parent branch
2. If parent branch now has 1 child: collapse -- replace branch with its sole child
3. Redistribute ratios among remaining siblings
4. If tree becomes empty: spawn fresh terminal (never leave user with 0 panes)

### Pane Navigation Algorithm

For Cmd+Option+Arrow (e.g., Right):
1. Find current focused leaf via DFS
2. Walk up tree until finding a branch with matching axis (horizontal for left/right, vertical for up/down)
3. Move to adjacent child in that branch
4. Descend to nearest leaf in the entered subtree (first leaf for right/down, last leaf for left/up)

### Recommended Component Structure

```
src/
  components/
    PaneContainer.tsx     # Recursive renderer: reads tree, renders Branch or Leaf
    SplitContainer.tsx    # Renders children with flexbox + splitter handles
    Splitter.tsx          # Draggable divider bar (6px hit area, 2px visible)
    TerminalPane.tsx      # Single pane: terminal + floating header
    PaneHeader.tsx        # Floating CWD overlay
  hooks/
    useTerminal.ts        # (existing, refactored) Takes paneId, manages xterm lifecycle
    useSplitterDrag.ts    # Pointer capture drag logic for splitter
    useKeyboardRegistry.ts # Shortcut registration + dispatch
    usePaneNavigation.ts  # Tree traversal for arrow key navigation
  stores/
    pane-tree.ts          # Zustand: tree state, split/close/navigate actions
    terminal.ts           # (existing, evolve to map of ptyId -> pane)
  lib/
    pane-tree-ops.ts      # Pure functions: splitNode, removeNode, findLeaf, navigate
    pty.ts                # (existing, add closePty)
```

### Recursive Renderer Pattern

```typescript
// PaneContainer.tsx -- recursive rendering
function PaneContainer({ node }: { node: PaneNode }) {
  if (node.type === 'leaf') {
    return <TerminalPane paneId={node.id} ptyId={node.ptyId} />;
  }
  return (
    <SplitContainer direction={node.direction} ratios={node.ratios} nodeId={node.id}>
      {node.children.map((child) => (
        <PaneContainer key={child.id} node={child} />
      ))}
    </SplitContainer>
  );
}
```

### SplitContainer with Flexbox

```typescript
// SplitContainer.tsx -- flexbox layout with splitters between children
function SplitContainer({ direction, ratios, nodeId, children }: Props) {
  const isHorizontal = direction === 'horizontal';
  const elements: ReactNode[] = [];

  React.Children.forEach(children, (child, i) => {
    if (i > 0) {
      elements.push(<Splitter key={`s-${i}`} nodeId={nodeId} index={i} direction={direction} />);
    }
    elements.push(
      <div
        key={`p-${i}`}
        style={{ flex: `${ratios[i]} 1 0%` }}
        className="overflow-hidden relative"
      >
        {child}
      </div>
    );
  });

  return (
    <div className={`flex h-full w-full ${isHorizontal ? 'flex-row' : 'flex-col'}`}>
      {elements}
    </div>
  );
}
```

### KeybindingRegistry Pattern

```typescript
// useKeyboardRegistry.ts
interface Keybinding {
  key: string;          // e.g. 'd', 'w', 'ArrowRight'
  meta: boolean;        // Cmd on macOS
  shift?: boolean;
  alt?: boolean;
  action: () => void;
}

function useKeyboardRegistry(bindings: Keybinding[]) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      for (const b of bindings) {
        if (
          e.key === b.key &&
          e.metaKey === b.meta &&
          (b.shift ?? false) === e.shiftKey &&
          (b.alt ?? false) === e.altKey
        ) {
          e.preventDefault();
          e.stopPropagation();
          b.action();
          return;
        }
      }
      // Unmatched: let event propagate to xterm.js
    }
    // Capture phase to intercept before xterm.js
    document.addEventListener('keydown', handler, { capture: true });
    return () => document.removeEventListener('keydown', handler, { capture: true });
  }, [bindings]);
}
```

### xterm.js Key Passthrough Coordination

xterm.js has `attachCustomKeyEventHandler` that returns `boolean` -- return `false` to prevent xterm from handling the key. Use this as a secondary guard:

```typescript
term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
  // Let our registry handle Cmd+key combos
  if (e.metaKey && ['d', 'w'].includes(e.key)) return false;
  if (e.metaKey && e.altKey && e.key.startsWith('Arrow')) return false;
  return true; // xterm handles everything else
});
```

### Anti-Patterns to Avoid

- **Storing absolute pixel sizes in tree**: Use flex ratios (0.0-1.0). Absolute sizes break on window resize and require recalculation. Ratios cascade automatically.
- **One Zustand store per pane**: Creates subscription hell. Use ONE store with the tree + a focusedPaneId. Components select what they need with selectors.
- **Deep cloning tree on every mutation**: Use immer or manual shallow updates. The tree is small (max ~20 nodes in practice) so even naive cloning is fine, but don't use JSON.parse(JSON.stringify()).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unique IDs for panes | Custom counter | `crypto.randomUUID()` | Built into all modern runtimes, zero deps |
| Focus management | Manual tabIndex tracking | React ARIA FocusScope | Accessibility edge cases are brutal |
| Pointer capture during drag | Manual mousemove/mouseup | `element.setPointerCapture()` | Handles pointer leaving window, touch, pen |

**Key insight:** The split pane tree is one of the few things worth hand-rolling because no library handles recursive nesting + WebGL lifecycle + xterm.js integration. But the drag mechanics and focus management have existing solutions.

## Common Pitfalls

### Pitfall 1: WebGL Context Exhaustion
**What goes wrong:** Browser limits WebGL contexts to ~16 (Chrome) or fewer (WebKit). Creating a WebGL context per pane means 16+ panes crashes all rendering.
**Why it happens:** Each `new WebglAddon()` creates a separate WebGL context on its canvas.
**How to avoid:** Implement a WebGL context budget. Only attach WebglAddon to visible/focused panes. When budget exceeded, dispose oldest non-focused context. Re-create when pane becomes visible.
**Warning signs:** Console warning "Too many active WebGL contexts. The oldest context will be lost."
**Budget strategy:** Set max at 8 (safe for all browsers). Track contexts in a Set. On new pane: if at budget, dispose LRU non-focused context. Terminal still works without WebGL (falls back to canvas in xterm 5, but in xterm 6 canvas is removed -- so must handle this).
**IMPORTANT for xterm 6:** Canvas renderer was removed in v6. If WebGL context is lost and not re-created, the terminal will NOT render. Must re-create WebGL context when pane regains focus/visibility.

### Pitfall 2: PTY Resize Race Condition
**What goes wrong:** Dragging a splitter fires ResizeObserver continuously, flooding the backend with resize_pty calls. PTY and shell disagree on dimensions, causing garbled output.
**Why it happens:** ResizeObserver fires synchronously on every frame during drag.
**How to avoid:** Debounce resize_pty calls at 100-150ms. Use requestAnimationFrame for fitAddon.fit() but debounce the IPC call.
**Warning signs:** Terminal output wraps incorrectly during/after resize.

### Pitfall 3: Missing close_pty Backend Command
**What goes wrong:** Closing a pane on the frontend doesn't kill the PTY process. Zombie shells accumulate.
**Why it happens:** Phase 1 never needed to close a terminal. No `close_pty` command exists in `pty.rs`.
**How to avoid:** Add `close_pty` Tauri command that: (1) kills child process, (2) drops writer, (3) drops master (closes PTY fd), (4) removes from PtyManager. Frontend calls this before removing pane from tree.

### Pitfall 4: Keyboard Shortcut Swallowed by xterm.js
**What goes wrong:** xterm.js captures Cmd+D (which some terminals interpret) before our keydown handler fires.
**Why it happens:** Event listener ordering. If xterm.js attaches its listener first on the same element, it processes the key first.
**How to avoid:** Register our keydown listener on `document` in capture phase (`{ capture: true }`). Capture phase fires before bubble phase, guaranteeing we see the event first.
**Warning signs:** Shortcuts work sometimes but not when terminal is focused.

### Pitfall 5: Splitter Handle Too Small to Grab
**What goes wrong:** 1-2px splitter bar is nearly impossible to click precisely.
**Why it happens:** Visual splitter matches its hit area.
**How to avoid:** Visual bar: 2px. Hit area (the actual element with pointer events): 6-8px, centered over the visual bar. Use a wider transparent div with a thin visible inner line.

### Pitfall 6: Tree State Desyncs from DOM
**What goes wrong:** Zustand tree updates but React doesn't re-render the changed subtree, leaving stale panes visible.
**Why it happens:** Shallow equality on complex tree objects. Zustand's default equality check may consider the tree "unchanged" if the same root reference is reused.
**How to avoid:** Always produce a new root object on mutation (spread operator at each level up to root). Or use `zustand/immer` middleware for structural sharing.

## Code Examples

### Zustand Pane Tree Store

```typescript
// stores/pane-tree.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { splitNode, removeNode, navigateFrom } from '../lib/pane-tree-ops';

interface PaneTreeState {
  root: PaneNode;
  focusedPaneId: PaneId | null;

  // Actions
  splitPane: (paneId: PaneId, direction: SplitDirection, newPtyId: number) => void;
  closePane: (paneId: PaneId) => void;
  setFocus: (paneId: PaneId) => void;
  navigate: (direction: 'up' | 'down' | 'left' | 'right') => void;
  updateRatio: (branchId: string, index: number, newRatio: number) => void;
}
```

### Splitter Drag Hook

```typescript
// hooks/useSplitterDrag.ts
function useSplitterDrag(
  nodeId: string,
  index: number,
  direction: SplitDirection,
) {
  const updateRatio = usePaneTreeStore((s) => s.updateRatio);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
    const container = (e.currentTarget as HTMLElement).parentElement!;
    const totalSize = direction === 'horizontal' ? container.offsetWidth : container.offsetHeight;

    const onPointerMove = (me: PointerEvent) => {
      const currentPos = direction === 'horizontal' ? me.clientX : me.clientY;
      const delta = (currentPos - startPos) / totalSize;
      updateRatio(nodeId, index, delta);
    };

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [nodeId, index, direction, updateRatio]);

  return { onPointerDown };
}
```

### close_pty Rust Command (needed addition)

```rust
// In pty.rs -- new command
#[tauri::command]
pub fn close_pty(
    pty_id: u32,
    state: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    // Kill child process
    if let Some(mut child) = manager.children.remove(&pty_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    // Drop writer and master (closes PTY file descriptors)
    manager.writers.remove(&pty_id);
    manager.masters.remove(&pty_id);
    Ok(())
}
```

### CWD Detection for Pane Header

Two approaches for getting CWD:
1. **OSC 7 parsing** (preferred): Modern shells emit `\x1b]7;file:///path/to/cwd\x07` when CWD changes. Parse this from terminal output.
2. **Polling via /proc or lsof** (fallback): Query child process CWD. On macOS, use `proc_pidinfo` or shell out to `lsof -p $PID`. Less clean.

For Phase 2, OSC 7 is the right approach -- most shells (zsh, bash with config, fish) emit it by default on macOS:

```typescript
// In useTerminal.ts -- parse OSC 7 from terminal data stream
// xterm.js exposes parser hooks
term.parser.registerOscHandler(7, (data: string) => {
  // data is like "file:///Users/pierre/project"
  try {
    const url = new URL(data);
    setCwd(decodeURIComponent(url.pathname));
  } catch {
    // Ignore malformed
  }
  return true; // handled
});
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 + @testing-library/react |
| Config file | vitest.config.ts |
| Quick run command | `bun run test` |
| Full suite command | `bun run test` (same -- unit only) |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TERM-02 | Split pane tree operations (split horizontal/vertical, recursive nesting) | unit | `bun run test -- pane-tree-ops` | No -- Wave 0 |
| TERM-03 | Ratio updates on drag | unit | `bun run test -- pane-tree-ops` | No -- Wave 0 |
| TERM-04 | Pane header renders CWD | unit | `bun run test -- PaneHeader` | No -- Wave 0 |
| TERM-05 | Pane navigation tree traversal | unit | `bun run test -- pane-tree-ops` | No -- Wave 0 |
| TERM-06 | Close pane + tree collapse | unit | `bun run test -- pane-tree-ops` | No -- Wave 0 |
| KEYS-01 | iTerm2 shortcut map | unit | `bun run test -- keybinding` | No -- Wave 0 |
| KEYS-02 | KeybindingRegistry matches and prevents default | unit | `bun run test -- keybinding` | No -- Wave 0 |
| KEYS-03 | Unmatched keys pass through | unit | `bun run test -- keybinding` | No -- Wave 0 |

### Rust Tests
| Behavior | Test Type | Command | File Exists? |
|----------|-----------|---------|-------------|
| close_pty removes entries from PtyManager | unit | `cargo test -p superagent --lib` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `bun run test`
- **Per wave merge:** `bun run test && cd src-tauri && cargo test`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] `src/lib/__tests__/pane-tree-ops.test.ts` -- covers TERM-02, TERM-03, TERM-05, TERM-06 (pure functions, most testable)
- [ ] `src/hooks/__tests__/useKeyboardRegistry.test.ts` -- covers KEYS-01, KEYS-02, KEYS-03
- [ ] `src/components/__tests__/PaneHeader.test.tsx` -- covers TERM-04
- [ ] Rust: `close_pty` unit test in `pty.rs` mod tests

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| xterm.js canvas fallback | WebGL-only (v6) | xterm.js 6.0, 2025 | MUST manage WebGL context lifecycle; no canvas fallback |
| allotment / react-split-pane | Custom tree + flexbox | Current best practice for terminals | Libraries don't handle recursive nesting + terminal lifecycle |
| Global shortcuts via OS | Window-scoped keydown capture | Always for terminal apps | Global shortcuts fire when app unfocused -- wrong for terminal |

## Open Questions

1. **OSC 7 shell support**
   - What we know: zsh on macOS emits OSC 7 by default via PROMPT_COMMAND. bash requires manual setup. fish emits it.
   - What's unclear: Whether the user's shell config preserves OSC 7 or if some dotfile frameworks disable it.
   - Recommendation: Implement OSC 7 parsing. If no CWD detected after 2s, fall back to showing the initial spawn directory. Phase 6 settings can add manual CWD polling.

2. **WebGL budget number for WebKit (Tauri uses WebKit on macOS)**
   - What we know: Chrome allows ~16. Firefox ~16 desktop, ~8 mobile.
   - What's unclear: WebKit's exact limit (Safari/Tauri). Could be lower than Chromium.
   - Recommendation: Start with budget of 8 (safe for all). Test empirically. Add a constant that's easy to tune.

3. **immer middleware for Zustand**
   - What we know: zustand has built-in immer middleware. Tree mutations are easier with immer.
   - What's unclear: Whether immer's proxy overhead matters for small trees.
   - Recommendation: Use immer -- tree is tiny (< 50 nodes), readability wins over micro-optimization. If not already installed, add `immer` as dependency.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src-tauri/src/pty.rs`, `src/hooks/useTerminal.ts`, `src/stores/terminal.ts`
- [Warp: Using tree data structures to implement terminal split panes](https://dev.to/warpdotdev/using-tree-data-structures-to-implement-terminal-split-panes-more-fun-than-it-sounds-2kon) -- architecture pattern
- [xterm.js addon-webgl README](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-webgl) -- context loss handling

### Secondary (MEDIUM confidence)
- [Chromium WebGL context limit discussion](https://issues.chromium.org/issues/40543269) -- 16 context limit
- [allotment npm](https://www.npmjs.com/package/allotment) -- v1.20.5, actively maintained but wrong tool for recursive nesting

### Tertiary (LOW confidence)
- WebKit exact context limit -- not verified, using conservative budget of 8

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new deps, all already in project
- Architecture: HIGH -- Warp blog documents identical pattern, verified against xterm.js v6 API
- Pitfalls: HIGH -- WebGL limit well-documented; resize race condition called out in STATE.md blockers
- Keyboard: HIGH -- capture phase keydown is standard pattern for terminal apps
- CWD detection: MEDIUM -- OSC 7 works but shell configuration varies

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable domain, no fast-moving deps)
