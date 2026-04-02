# Phase 5: Agent Detection + Status UI - Context

**Gathered:** 2026-04-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Detect AI agents running in terminal panes via process tree inspection, show status indicators everywhere (panes, tabs, sidebar), agent overview overlay, toast notifications for cross-workspace events, and manual toggle. Requirements: AGNT-01–10, TABS-04, TABS-05, SIDE-03, SIDE-04.

</domain>

<decisions>
## Implementation Decisions

### Agent detection mechanism
- **D-01:** Event-driven via macOS kqueue (EVFILT_PROC) on PTY child PIDs — no polling, no sysinfo dependency
- **D-02:** Register NOTE_FORK, NOTE_EXEC, NOTE_EXIT watchers when PTY spawns; kernel notifies on process events
- **D-03:** On fork/exec event, check new child process name against configurable known_agents list (claude, codex, aider, gemini, etc.)
- **D-04:** Agent presence detection latency: < 1ms (kernel event)

### Waiting vs running detection
- **D-05:** Track `last_output_timestamp` (atomic) per PTY in Rust backend — zero cost, bytes already flow through reader thread
- **D-06:** Agent alive + no output for 15s → transition to "waiting" (single tokio timer, not polling)
- **D-07:** First byte of output after silence → instant transition back to "running" (byte-level, real-time)
- **D-08:** Agent process exits (kqueue NOTE_EXIT) → "idle"
- **D-09:** Three states only: running, waiting, idle

### Frontend event delivery
- **D-10:** Rust emits Tauri event `agent-status-changed` with `{ ptyId, status, agentName, pid }`
- **D-11:** Frontend listens via `@tauri-apps/api/event` → updates Zustand agent store
- **D-12:** Fully event-driven end-to-end — no frontend polling

### Agent overlay (Cmd+Shift+O)
- **D-13:** Centered floating panel, 520px wide, max 60vh tall, frosted glass (backdrop-blur + semi-transparent bg)
- **D-14:** Rows grouped by workspace. Each row: status dot, agent name, branch, CWD (last segment), live ticking duration
- **D-15:** Keyboard navigable: arrow keys to select row, Enter to jump (switches to that tab/pane, closes overlay)
- **D-16:** Hover highlights row. Waiting rows get amber tint treatment
- **D-17:** Header shows live counter pill: "N running · N waiting" using status colors
- **D-18:** Empty state: overlay opens with muted "No agents running" + hint text
- **D-19:** Live updates while open — durations tick, dots change, rows appear/disappear with subtle fade transitions
- **D-20:** Esc or click outside to dismiss

### Status indicators
- **D-21:** Pane: colored dot in PaneHeader + amber border glow + inset shadow when waiting (AGNT-10)
- **D-22:** Tab: status dot (green pulse = running, amber = waiting) + amber background tint + "input" pill badge when waiting (TABS-04, TABS-05)
- **D-23:** Sidebar: agent status dots on items (SIDE-03), collapsed repo shows summary dots (SIDE-04)
- **D-24:** Status bar: agent summary text ("2 running", "1 waiting") using status colors

### Manual toggle
- **D-25:** Cmd+Shift+A toggles agent indicator per focused pane (manual override)

### Claude's Discretion
- Exact kqueue watcher implementation (raw libc vs kqueue crate)
- Agent store shape and cross-store integration pattern
- Animation details (pulse speed, glow intensity, fade timing)
- Toast notification design for agent events (deferred from deep discussion)
- Notification grouping when multiple events fire simultaneously (revisit later)
- Status dot size and exact positioning on pane header, tabs, sidebar

</decisions>

<specifics>
## Specific Ideas

- Overlay should feel like "Raycast meets Linear" — instant situational awareness, glance and dismiss
- Everything real-time, no polling anywhere in the stack
- The 15s silence threshold is intentional design, not a limitation — avoids false positives during API thinking pauses
- Amber glow should be noticeable but not loud — subtle enough to not distract, visible enough to catch peripheral attention

</specifics>

<canonical_refs>
## Canonical References

No external specs — requirements are fully captured in decisions above and in:
- `.planning/REQUIREMENTS.md` — AGNT-01..10, TABS-04..05, SIDE-03..04 definitions
- `.planning/ROADMAP.md` §Phase 5 — success criteria, dependency on Phase 4
- `.planning/phases/03-tabs-themes-statusbar/03-CONTEXT.md` — D-19 reserved status bar agent summary slot for Phase 5

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src-tauri/src/pty.rs`: PtyManager holds `children` HashMap with child processes — extract PID for kqueue watchers
- `src/lib/toast.ts`: UNSTABLE_ToastQueue from react-aria — extend with agent event toast types
- `src/stores/tabs-store.ts`: Tab interface — add agentStatus/agentName fields to Tab or LeafNode
- `src/hooks/useKeyboardRegistry.ts`: Capture-phase interceptor — add Cmd+Shift+A and Cmd+Shift+O bindings
- `src/components/StatusBar.tsx`: Already has agent summary slot (right side) — fill with real data
- `src/components/CreateModal.tsx`: Modal pattern (fixed overlay, backdrop, Dialog, click-outside, Esc) — adapt for overlay
- `src/lib/themes.ts`: CssThemeProperties + 8 themes — add agent status color tokens
- `src/lib/pane-tree-ops.ts`: LeafNode interface — add optional agent fields

### Established Patterns
- Zustand + immer stores for state management
- Tauri event emission from Rust → frontend `listen()` from `@tauri-apps/api/event`
- CSS custom properties for all colors, applied via `data-theme` attribute
- Keyboard registry: `Keybinding[]` array in App.tsx
- Modal: plain div overlay + react-aria Dialog (not ModalOverlay, for testability)
- Lazy async import for Tauri plugins to keep components testable

### Integration Points
- `src-tauri/src/pty.rs`: After spawn_terminal(), register kqueue watcher on child PID
- `src-tauri/src/lib.rs`: Register new commands (start_agent_watching, stop_agent_watching, toggle_agent_manual)
- `src/App.tsx`: Add Cmd+Shift+A and Cmd+Shift+O bindings, render AgentOverlay conditionally
- `src/components/TerminalPane.tsx`: Pass agentStatus to PaneHeader, render amber glow when waiting
- `src/components/PaneHeader.tsx`: Render colored status dot based on agent state
- `src/components/TabBar.tsx`: Render status dot and amber tint/badge on tabs
- `src/components/Sidebar.tsx`: Render agent dots on workspace items
- `src/components/StatusBar.tsx`: Fill agent summary slot with live counts
- `src/index.css`: Add agent status color tokens to all 8 themes

</code_context>

<deferred>
## Deferred Ideas

- Notification grouping/batching when multiple agent events fire simultaneously — revisit in Phase 6 or follow-up
- Replace xterm.js with ghostty-web (WASM terminal renderer) — separate evaluation, orthogonal to agent detection
- Per-agent prompt pattern matching for more precise waiting detection — future refinement if 15s threshold proves insufficient
- Configurable silence threshold in Settings — Phase 6 (SETT-05)

</deferred>

---

*Phase: 05-agent-detection-status-ui*
*Context gathered: 2026-04-02*
