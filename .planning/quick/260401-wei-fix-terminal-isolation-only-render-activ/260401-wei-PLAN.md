---
type: quick
quick_id: 260401-wei
slug: fix-terminal-isolation-only-render-activ
description: "Fix terminal isolation: only render active tab PaneContainer"
---

<objective>
Fix xterm.js WebGL canvases bleeding through inactive tabs. Currently App.tsx renders all tabs' PaneContainers with `display:none` for inactive ones, but WebGL canvases don't respect CSS display:none. Change to conditional rendering — only mount the active tab's PaneContainer. The terminal-cache system already handles detach/reattach on unmount/remount.
</objective>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Conditionally render only active tab's PaneContainer</name>
  <files>
    src/App.tsx,
    src/App.test.tsx
  </files>
  <read_first>
    src/App.tsx
  </read_first>
  <behavior>
    - Only the active tab's PaneContainer should be mounted in the DOM
    - Inactive tabs should NOT have PaneContainer rendered (not even with display:none)
    - When switching tabs, the old PaneContainer unmounts (triggering useTerminal cleanup which detaches xterm from DOM but keeps in cache)
    - When switching back to a tab, PaneContainer remounts and useTerminal finds cached entry, reparenting the xterm DOM element
    - Tab switching should preserve terminal state (scrollback, CWD, running processes)
  </behavior>
  <action>
    In App.tsx, change the tabs.map block from:
    ```tsx
    {tabs.map((tab) => (
      <div
        key={tab.id}
        className="absolute inset-0"
        style={{ display: tab.id === activeTabId ? 'block' : 'none' }}
      >
        <PaneContainer root={tab.paneRoot} />
      </div>
    ))}
    ```
    To:
    ```tsx
    {tabs.map((tab) =>
      tab.id === activeTabId ? (
        <div key={tab.id} className="absolute inset-0">
          <PaneContainer root={tab.paneRoot} />
        </div>
      ) : null
    )}
    ```

    Update any existing tests in App.test.tsx if they assert on multiple PaneContainers being rendered simultaneously.
  </action>
  <verify>
    <automated>cd /Users/pierre/Workspace/perso/superagent && npx vitest run --reporter=verbose 2>&1 | tail -30</automated>
  </verify>
  <done>
    Only active tab's PaneContainer is mounted. Inactive tabs have no DOM presence. Terminal cache handles state preservation across tab switches.
  </done>
</task>

</tasks>

<verification>
1. `npx vitest run --reporter=verbose 2>&1 | tail -20` — all tests pass
2. Visual: switch between workspace items in sidebar, confirm only active tab's terminals are visible
</verification>
