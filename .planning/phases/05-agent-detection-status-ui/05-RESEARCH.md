# Phase 5: Agent Detection + Status UI - Research

**Researched:** 2026-04-02
**Domain:** macOS process monitoring (kqueue), Tauri event system, Zustand state management, React ARIA toast
**Confidence:** HIGH

## Summary

Phase 5 adds event-driven AI agent detection using macOS kqueue (EVFILT_PROC) on PTY child PIDs, a silence-based "waiting" heuristic (15s no output), and propagates status through Tauri events to a new Zustand agent store. The frontend renders status dots on panes, tabs, sidebar items, and the status bar. An agent overlay (Cmd+Shift+O) provides cross-workspace awareness, and toast notifications alert on events in non-active workspaces.

The core technical challenge is wiring kqueue process watchers to the PTY lifecycle in Rust, tracking output timestamps in the reader thread, and managing the timer-based waiting transition. The frontend work is straightforward Zustand store + component integration following established patterns.

**Primary recommendation:** Use the `kqueue` crate (1.1.1) with `Watcher::add_pid()` for process monitoring. Track `last_output_timestamp` as `Arc<AtomicU64>` in the PTY reader thread. Run the kqueue watcher on a dedicated `std::thread` (not tokio -- matches PTY reader pattern). Emit `agent-status-changed` Tauri events from Rust, consumed by a dedicated `agent-store.ts` on the frontend.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Event-driven via macOS kqueue (EVFILT_PROC) on PTY child PIDs -- no polling, no sysinfo dependency
- **D-02:** Register NOTE_FORK, NOTE_EXEC, NOTE_EXIT watchers when PTY spawns; kernel notifies on process events
- **D-03:** On fork/exec event, check new child process name against configurable known_agents list (claude, codex, aider, gemini, etc.)
- **D-04:** Agent presence detection latency: < 1ms (kernel event)
- **D-05:** Track `last_output_timestamp` (atomic) per PTY in Rust backend -- zero cost, bytes already flow through reader thread
- **D-06:** Agent alive + no output for 15s -> transition to "waiting" (single tokio timer, not polling)
- **D-07:** First byte of output after silence -> instant transition back to "running" (byte-level, real-time)
- **D-08:** Agent process exits (kqueue NOTE_EXIT) -> "idle"
- **D-09:** Three states only: running, waiting, idle
- **D-10:** Rust emits Tauri event `agent-status-changed` with `{ ptyId, status, agentName, pid }`
- **D-11:** Frontend listens via `@tauri-apps/api/event` -> updates Zustand agent store
- **D-12:** Fully event-driven end-to-end -- no frontend polling
- **D-13 to D-20:** Agent overlay design (centered, 520px, frosted glass, keyboard navigable, live updates)
- **D-21 to D-24:** Status indicator placement (pane header dot, tab dot/badge/tint, sidebar dots, status bar summary)
- **D-25:** Cmd+Shift+A toggles agent indicator per focused pane (manual override)

### Claude's Discretion
- Exact kqueue watcher implementation (raw libc vs kqueue crate)
- Agent store shape and cross-store integration pattern
- Animation details (pulse speed, glow intensity, fade timing)
- Toast notification design for agent events
- Notification grouping when multiple events fire simultaneously
- Status dot size and exact positioning on pane header, tabs, sidebar

### Deferred Ideas (OUT OF SCOPE)
- Notification grouping/batching -- revisit Phase 6 or follow-up
- Replace xterm.js with ghostty-web -- separate evaluation
- Per-agent prompt pattern matching for waiting detection -- future refinement
- Configurable silence threshold in Settings -- Phase 6 (SETT-05)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AGNT-01 | Agent detection per active PTY via process tree inspection | kqueue EVFILT_PROC on child PID; `portable_pty::Child::process_id()` returns `Option<u32>` for PID extraction |
| AGNT-02 | Match process names against configurable known_agents list | kqueue NOTE_EXEC event + `libproc::proc_pid::name()` or `/proc/{pid}/comm` equivalent via `sysinfo::Process::name()` for name resolution |
| AGNT-03 | Agent status changes emit events to frontend | Tauri `app.emit("agent-status-changed", payload)` pattern |
| AGNT-04 | Manual toggle agent indicator per PTY (Cmd+Shift+A) | Keyboard registry pattern established; agent store `manualOverrides` map |
| AGNT-05 | Agent overview overlay (Cmd+Shift+O) | React ARIA Dialog pattern from CreateModal; Zustand selectors for cross-workspace agent data |
| AGNT-06 | Click agent row to jump to workspace/tab | Cross-store action: agent-store -> workspace-store.selectWorkspaceItem + tabs-store.switchTab |
| AGNT-07 | Toast notifications for non-active workspace events | Extend existing `toastQueue` with agent event types; separate `AgentToastRegion` |
| AGNT-08 | Toast shows event type, workspace/branch, "Jump"/"Dismiss" actions | Custom `AgentToastContent` interface with actionable buttons |
| AGNT-09 | Completion toasts auto-dismiss 10s; waiting toasts persist | `toastQueue.add()` with `timeout: 10000` for completion, `timeout: Infinity` for waiting |
| AGNT-10 | Pane amber border glow + inset shadow when waiting | CSS custom properties `--agent-waiting` + conditional class on TerminalPaneInner |
| TABS-04 | Tab shows agent status dot (green pulse, amber waiting) | TabItem receives agentStatus from agent store; CSS animation for pulse |
| TABS-05 | Waiting tab shows amber tint + "input" pill badge | Conditional className on TabItem based on agentStatus === 'waiting' |
| SIDE-03 | Sidebar items show agent status dots | WorkspaceTree items receive agent status via derived selector |
| SIDE-04 | Collapsed repo shows agent summary dots + chevron | Aggregate agent status per workspace in agent store |
</phase_requirements>

## Standard Stack

### Core (Rust -- new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| kqueue | 1.1.1 | macOS process event monitoring | Safe Rust wrapper over kqueue(2). `Watcher::add_pid()` with EVFILT_PROC, NOTE_FORK/EXEC/EXIT. No unsafe needed. |
| kqueue-sys | 1.0.4 | Low-level constants (transitive dep) | Provides FilterFlag::NOTE_FORK, NOTE_EXEC, NOTE_EXIT, NOTE_CHILD constants |
| libc | (already transitive) | pid_t type, process info | Already pulled in by portable-pty and tokio |

### Core (Frontend -- no new dependencies)

| Library | Version | Purpose | Already In Stack |
|---------|---------|---------|-----------------|
| zustand + immer | 5.x | Agent store | Yes -- established pattern |
| @tauri-apps/api/event | 2.x | Listen for Rust events | Yes -- used implicitly |
| react-aria-components | 1.16.0 | Dialog (overlay), Toast (agent events) | Yes -- UNSTABLE_Toast already used |

### Process Name Resolution (Rust)

| Approach | Details | Recommendation |
|----------|---------|----------------|
| `libproc` crate | `libproc::proc_pid::name(pid)` -- macOS native, lightweight | **USE THIS** -- minimal dep, macOS-only project |
| `sysinfo` crate | `System::new()` + refresh + process lookup | Overkill -- pulls in full system info for one PID name lookup |
| Raw `proc_pidinfo` via libc | Manual FFI | Unnecessary when libproc crate exists |

**Installation (Cargo.toml additions):**
```toml
kqueue = "1.1"
libproc = "0.14"
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| kqueue crate | Raw libc::kqueue FFI | More code, more unsafe blocks, no benefit for macOS-only |
| kqueue crate | sysinfo polling (2s) | Violates D-01 (no polling), 2s latency vs <1ms |
| libproc | sysinfo for process name | 10x heavier dependency for a single function |
| Dedicated watcher thread | tokio::spawn | PTY reader is std::thread already; kqueue `iter()` is blocking -- matches pattern |

## Architecture Patterns

### Recommended Project Structure

```
src-tauri/src/
├── pty.rs              # Existing -- add last_output_timestamp, extract child PID
├── agent_watcher.rs    # NEW: kqueue watcher thread, process name resolution, state machine
├── lib.rs              # Register new commands, manage AgentWatcherState
└── ...

src/
├── stores/
│   └── agent-store.ts  # NEW: Zustand store for agent status per ptyId
├── components/
│   ├── AgentOverlay.tsx    # NEW: Cmd+Shift+O overlay
│   ├── AgentToastRegion.tsx # NEW: Agent event toasts
│   ├── StatusDot.tsx       # NEW: Reusable status dot component
│   ├── PaneHeader.tsx      # MODIFY: Add status dot
│   ├── TabBar.tsx          # MODIFY: Add status dot, amber tint, badge
│   ├── StatusBar.tsx       # MODIFY: Fill agent summary slot
│   ├── Sidebar.tsx         # MODIFY: Pass agent status through
│   └── WorkspaceTree.tsx   # MODIFY: Render agent dots
├── lib/
│   └── toast.ts            # EXTEND: Add agent toast types and queue
└── App.tsx                 # MODIFY: Add keyboard bindings, overlay state, agent listeners
```

### Pattern 1: Kqueue Watcher Thread

**What:** Dedicated `std::thread` runs kqueue `Watcher::iter()` blocking loop. On process events, resolves child name against known_agents list, updates shared state, emits Tauri events.

**When to use:** Always -- this is the only pattern for event-driven process monitoring on macOS.

**Example:**
```rust
// agent_watcher.rs
use kqueue::{Watcher, EventFilter, FilterFlag};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;

pub struct AgentState {
    pub pty_id: u32,
    pub status: AgentStatus,  // Running, Waiting, Idle
    pub agent_name: String,
    pub pid: u32,
    pub started_at: std::time::Instant,
}

#[derive(Clone, serde::Serialize)]
pub enum AgentStatus {
    Running,
    Waiting,
    Idle,
}

pub fn start_watching(pid: libc::pid_t, pty_id: u32, app_handle: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut watcher = Watcher::new().expect("kqueue init");
        watcher.add_pid(
            pid,
            EventFilter::EVFILT_PROC,
            FilterFlag::NOTE_FORK | FilterFlag::NOTE_EXEC | FilterFlag::NOTE_EXIT,
        ).expect("add_pid");
        watcher.watch().expect("watch");

        for event in watcher.iter() {
            // Handle NOTE_FORK | NOTE_EXEC: resolve child name, check known_agents
            // Handle NOTE_EXIT: transition to idle, emit event
            // app_handle.emit("agent-status-changed", payload);
        }
    });
}
```

### Pattern 2: Output Timestamp Tracking

**What:** `Arc<AtomicU64>` storing epoch millis of last PTY output. Updated in reader thread (zero-cost -- already reading bytes). A single tokio timer checks all active agents every second, transitions to "waiting" if `now - last_output > 15s`.

**When to use:** For silence-based waiting detection (D-05 through D-07).

**Example:**
```rust
// In PTY reader thread (pty.rs spawn_terminal):
let last_output = Arc::new(AtomicU64::new(now_millis()));
let last_output_clone = last_output.clone();

std::thread::spawn(move || {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                last_output_clone.store(now_millis(), Ordering::Relaxed);
                if on_output.send(buf[..n].to_vec()).is_err() { break; }
            }
            Err(_) => break,
        }
    }
});
```

### Pattern 3: Agent Store (Frontend)

**What:** Dedicated Zustand store keyed by ptyId. Listens to `agent-status-changed` Tauri events. Components subscribe to specific agent status via selectors.

**Example:**
```typescript
// agent-store.ts
interface AgentInfo {
  ptyId: number;
  status: 'running' | 'waiting' | 'idle';
  agentName: string;
  pid: number;
  startedAt: number;
  manualOverride: boolean; // Cmd+Shift+A toggle
}

interface AgentState {
  agents: Record<number, AgentInfo>; // keyed by ptyId
  setAgent: (ptyId: number, info: AgentInfo) => void;
  removeAgent: (ptyId: number) => void;
  toggleManualOverride: (ptyId: number) => void;
  getAgentForPty: (ptyId: number) => AgentInfo | undefined;
  getRunningCount: () => number;
  getWaitingCount: () => number;
  getAllAgents: () => AgentInfo[];
}
```

### Pattern 4: StatusDot Component

**What:** Reusable component rendering a colored circle with optional pulse animation. Used in PaneHeader, TabBar, Sidebar, and Overlay.

**Example:**
```typescript
// StatusDot.tsx
type DotStatus = 'running' | 'waiting' | 'idle';

export function StatusDot({ status, size = 8 }: { status: DotStatus; size?: number }) {
  return (
    <span
      className={`inline-block rounded-full ${
        status === 'running' ? 'bg-agent-running animate-pulse-slow' :
        status === 'waiting' ? 'bg-agent-waiting animate-breathe' :
        'bg-transparent'
      }`}
      style={{ width: size, height: size }}
    />
  );
}
```

### Pattern 5: Agent Overlay (Dialog)

**What:** Follows CreateModal pattern: plain div overlay + react-aria Dialog. Not ModalOverlay (testability). Keyboard navigable with arrow keys.

**Key differences from CreateModal:**
- No form content -- read-only list with live updates
- Grouped by workspace
- Live ticking durations (requestAnimationFrame or 1s interval)
- Arrow key navigation to select rows, Enter to jump

### Anti-Patterns to Avoid

- **Polling sysinfo in a loop:** Violates D-01. Use kqueue event-driven approach only.
- **Frontend timers for status:** All state transitions happen in Rust. Frontend is purely reactive.
- **Storing agent state in tabs-store:** Keep agent-store separate. Cross-reference by ptyId. Avoids coupling and re-render cascades.
- **filter/map in Zustand selectors:** Known project pitfall (infinite re-renders). Use stable selectors with `.find()` for single items.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Process event monitoring | Custom poll loop with sysinfo | kqueue crate `Watcher::add_pid()` | Kernel-level events, <1ms latency, zero CPU when idle |
| Process name resolution | Parse /proc or ps output | `libproc::proc_pid::name(pid)` | Direct syscall, no fork/exec, type-safe |
| Toast queue management | Custom toast state | `UNSTABLE_ToastQueue` from react-aria | Already in use, handles queue, timeouts, a11y |
| Accessible overlay/dialog | Custom div with keyboard handling | react-aria `Dialog` | Focus trapping, Esc dismiss, aria attributes |
| CSS pulse animations | JS-driven animation | CSS `@keyframes` with Tailwind arbitrary values | GPU-accelerated, zero JS overhead |

## Common Pitfalls

### Pitfall 1: kqueue Watcher Lifetime vs PTY Lifetime
**What goes wrong:** kqueue watcher thread outlives the PTY it monitors, or PTY closes before watcher is cleaned up.
**Why it happens:** Separate thread lifecycles. PTY close (`close_pty`) must signal watcher to stop.
**How to avoid:** Store a `HashMap<u32, oneshot::Sender<()>>` for cancellation. On `close_pty`, send cancel signal. Watcher thread checks cancel channel alongside kqueue events.
**Warning signs:** Zombie watcher threads accumulating, kqueue errors on dead PIDs.

### Pitfall 2: Race Between Fork/Exec and Name Resolution
**What goes wrong:** kqueue fires NOTE_FORK before the child has exec'd, so `libproc::name()` returns the shell name, not the agent name.
**Why it happens:** Fork creates a copy of parent process. Exec replaces it with the agent binary. These are separate events.
**How to avoid:** On NOTE_FORK, record the child PID. On NOTE_EXEC (which fires after exec completes), resolve the name. Only then check against known_agents.
**Warning signs:** Agents detected as "bash" or "zsh" instead of "claude".

### Pitfall 3: Child PID vs Grandchild PID
**What goes wrong:** The shell (direct child of PTY) forks, but the agent might be a grandchild (shell -> node -> claude).
**Why it happens:** Shells often fork subshells. `claude` CLI may be a node script that spawns a child.
**How to avoid:** Use NOTE_CHILD flag with NOTE_FORK. kqueue can track child processes of watched PIDs. Walk the process tree up to 3 levels. Also watch for NOTE_EXEC at each level.
**Warning signs:** Agent running in terminal but not detected.

### Pitfall 4: AtomicU64 Ordering
**What goes wrong:** Stale timestamp reads cause premature or delayed waiting transition.
**Why it happens:** Using `Ordering::SeqCst` is correct but slow; `Ordering::Relaxed` might miss updates across threads.
**How to avoid:** Use `Ordering::Relaxed` for store (writer thread) and `Ordering::Relaxed` for load (timer thread). The 15s threshold is so coarse that microsecond-level staleness is irrelevant. This is the correct choice for a monotonically increasing timestamp.
**Warning signs:** None -- this is a non-issue with 15s granularity, but document the reasoning.

### Pitfall 5: Zustand Selector Stability for Agent Status
**What goes wrong:** Components re-render on every agent store update, even when their specific agent hasn't changed.
**Why it happens:** Using `Object.values(agents)` or `.filter()` in selectors creates new arrays every time.
**How to avoid:** Select specific ptyId: `useAgentStore(s => s.agents[ptyId])`. For counts, use computed selectors that return primitives. For the overlay list, use `useMemo` to stabilize.
**Warning signs:** Laggy UI when multiple agents are running, unnecessary re-renders in React DevTools.

### Pitfall 6: Toast Spam on Rapid State Changes
**What goes wrong:** Agent rapidly toggles between running/waiting, flooding the toast queue.
**Why it happens:** Output arrives in bursts with gaps. Threshold might be too sensitive.
**How to avoid:** Debounce waiting transitions on the Rust side (15s is already conservative). For toasts specifically, only emit for transitions that persist for >2s. Track "last toast time" per agent to prevent duplicates within 5s.
**Warning signs:** Toast region fills with identical notifications.

### Pitfall 7: portable-pty process_id() Returns None
**What goes wrong:** `child.process_id()` returns `None`, leaving no PID to watch.
**Why it happens:** On some edge cases or after process exit, PID may not be available.
**How to avoid:** Extract PID immediately after `spawn_command()`, before any other operations. Store it alongside the child handle. If None, skip kqueue registration for that PTY (graceful degradation).
**Warning signs:** Agent detection silently fails for specific terminals.

## Code Examples

### Kqueue Process Watcher (Rust)

```rust
// Source: docs.rs/kqueue/1.1.1 + macOS kqueue(2) man page
use kqueue::{Watcher, EventFilter, FilterFlag, EventData};

fn watch_pty_child(pid: libc::pid_t) -> Result<(), Box<dyn std::error::Error>> {
    let mut watcher = Watcher::new()?;

    // Watch for fork, exec, and exit events on the shell PID
    watcher.add_pid(
        pid,
        EventFilter::EVFILT_PROC,
        FilterFlag::NOTE_FORK | FilterFlag::NOTE_EXEC | FilterFlag::NOTE_EXIT,
    )?;
    watcher.watch()?;

    for event in watcher.iter() {
        match event.data {
            EventData::Proc(flags) => {
                if flags.contains(FilterFlag::NOTE_FORK) {
                    // Child forked -- get child PID from event ident
                    // Register watcher on child PID too
                }
                if flags.contains(FilterFlag::NOTE_EXEC) {
                    // Process exec'd -- resolve name via libproc
                    // let name = libproc::proc_pid::name(pid)?;
                    // Check against known_agents
                }
                if flags.contains(FilterFlag::NOTE_EXIT) {
                    // Process exited -- transition to idle
                }
            }
            _ => {}
        }
    }
    Ok(())
}
```

### Tauri Event Emission (Rust)

```rust
// Source: Tauri v2 event system (established project pattern)
#[derive(Clone, serde::Serialize)]
struct AgentStatusPayload {
    pty_id: u32,
    status: String,  // "running" | "waiting" | "idle"
    agent_name: String,
    pid: u32,
}

// From watcher thread:
app_handle.emit("agent-status-changed", AgentStatusPayload {
    pty_id,
    status: "running".into(),
    agent_name: "claude".into(),
    pid: child_pid as u32,
}).ok();
```

### Frontend Event Listener (TypeScript)

```typescript
// Source: @tauri-apps/api/event (established project pattern)
import { listen } from '@tauri-apps/api/event';

interface AgentStatusEvent {
  ptyId: number;
  status: 'running' | 'waiting' | 'idle';
  agentName: string;
  pid: number;
}

// In App.tsx useEffect:
const unlisten = await listen<AgentStatusEvent>('agent-status-changed', (event) => {
  useAgentStore.getState().setAgent(event.payload.ptyId, {
    ...event.payload,
    startedAt: Date.now(),
    manualOverride: false,
  });
});
```

### CSS Agent Status Tokens

```css
/* Add to :root and all [data-theme="*"] blocks in index.css */
--agent-running: #4ade80;    /* green-400 */
--agent-waiting: #fbbf24;    /* amber-400 */
--agent-running-pulse: #22c55e; /* green-500 for pulse keyframe */
--agent-waiting-glow: rgba(251, 191, 36, 0.15); /* amber glow */
--agent-waiting-border: rgba(251, 191, 36, 0.4); /* amber border */
```

### Agent Toast with Actions

```typescript
// Extending existing toast.ts pattern
export interface AgentToastContent {
  type: 'agent-complete' | 'agent-waiting';
  agentName: string;
  workspace: string;
  branch: string;
  onJump: () => void;
}

export const agentToastQueue = new UNSTABLE_ToastQueue<AgentToastContent>({
  maxVisibleToasts: 3,
});

// Usage:
agentToastQueue.add({
  type: 'agent-waiting',
  agentName: 'claude',
  workspace: 'superagent',
  branch: 'feature/detection',
  onJump: () => { /* switch workspace + tab */ },
}, { timeout: undefined }); // Persists until dismissed
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| sysinfo polling (2s interval) | kqueue EVFILT_PROC events | User decision D-01 | <1ms latency, zero CPU idle, no sysinfo dep |
| Frontend polling for status | Rust event emission via Tauri | User decision D-12 | Fully reactive, no timers on frontend |
| Canvas terminal renderer | WebGL only (xterm.js v6) | Phase 1 | Performance headroom for overlay compositing |

**Agent binary names (current as of 2026-04):**
- `claude` -- Anthropic Claude Code CLI (node-based, may appear as `node` parent with `claude` child)
- `codex` -- OpenAI Codex CLI
- `aider` -- Aider CLI (Python-based, may appear as `python` parent)
- `gemini` -- Google Gemini CLI
- Custom entries via known_agents configuration

## Open Questions

1. **kqueue NOTE_CHILD behavior on macOS**
   - What we know: NOTE_CHILD should deliver child PID info when a watched process forks
   - What's unclear: Exact event data structure for child PID delivery in the kqueue Rust crate
   - Recommendation: Test empirically during implementation. Fallback: enumerate children via `libproc::proc_pid::listpids()` on NOTE_FORK event

2. **Process tree depth for agent detection**
   - What we know: Shell spawns commands, but `claude` may be `node -> claude` (2 levels deep)
   - What's unclear: Maximum practical depth across all known agents
   - Recommendation: Watch up to 3 levels of descendants. Most agents are 1-2 levels from shell.

3. **libproc crate version and macOS compatibility**
   - What we know: libproc 0.14 provides `proc_pid::name()` on macOS
   - What's unclear: Whether version 0.14 is latest, API stability
   - Recommendation: Verify version during implementation with `cargo search libproc`

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (frontend) + cargo test (Rust) |
| Config file | `vitest.config.ts` (frontend), inline in Cargo.toml (Rust) |
| Quick run command | `bunx vitest run --reporter=verbose` |
| Full suite command | `bunx vitest run && cd src-tauri && cargo test` |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AGNT-01 | Agent detection via process tree | unit (Rust) | `cd src-tauri && cargo test agent_watcher` | No -- Wave 0 |
| AGNT-02 | Known agents list matching | unit (Rust) | `cd src-tauri && cargo test agent_watcher::tests::test_known_agents` | No -- Wave 0 |
| AGNT-03 | Status change event emission | unit (Rust) | `cd src-tauri && cargo test agent_watcher::tests::test_status_event` | No -- Wave 0 |
| AGNT-04 | Manual toggle (Cmd+Shift+A) | unit (TS) | `bunx vitest run src/stores/__tests__/agent-store.test.ts` | No -- Wave 0 |
| AGNT-05 | Agent overlay renders | unit (TS) | `bunx vitest run src/components/__tests__/AgentOverlay.test.tsx` | No -- Wave 0 |
| AGNT-06 | Jump to workspace from overlay | unit (TS) | `bunx vitest run src/components/__tests__/AgentOverlay.test.tsx` | No -- Wave 0 |
| AGNT-07 | Toast notifications for events | unit (TS) | `bunx vitest run src/components/__tests__/AgentToastRegion.test.tsx` | No -- Wave 0 |
| AGNT-08 | Toast content with actions | unit (TS) | `bunx vitest run src/components/__tests__/AgentToastRegion.test.tsx` | No -- Wave 0 |
| AGNT-09 | Auto-dismiss vs persist behavior | unit (TS) | `bunx vitest run src/stores/__tests__/agent-store.test.ts` | No -- Wave 0 |
| AGNT-10 | Amber border glow on waiting | unit (TS) | `bunx vitest run src/components/__tests__/TerminalPane.test.tsx` | No -- Wave 0 |
| TABS-04 | Tab status dot rendering | unit (TS) | `bunx vitest run src/components/__tests__/TabBar.test.tsx` | No -- Wave 0 |
| TABS-05 | Waiting tab amber tint + badge | unit (TS) | `bunx vitest run src/components/__tests__/TabBar.test.tsx` | No -- Wave 0 |
| SIDE-03 | Sidebar agent dots | unit (TS) | `bunx vitest run src/components/__tests__/WorkspaceTree.test.tsx` | Exists -- extend |
| SIDE-04 | Collapsed repo summary dots | unit (TS) | `bunx vitest run src/components/__tests__/WorkspaceTree.test.tsx` | Exists -- extend |

### Sampling Rate
- **Per task commit:** `bunx vitest run --reporter=verbose`
- **Per wave merge:** `bunx vitest run && cd src-tauri && cargo test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src-tauri/src/agent_watcher.rs` -- Rust module + unit tests for state machine, known_agents matching
- [ ] `src/stores/__tests__/agent-store.test.ts` -- agent store CRUD, toggle, computed selectors
- [ ] `src/components/__tests__/AgentOverlay.test.tsx` -- overlay rendering, keyboard nav, jump action
- [ ] `src/components/__tests__/AgentToastRegion.test.tsx` -- toast rendering, auto-dismiss, persist
- [ ] `src/components/__tests__/StatusDot.test.tsx` -- dot rendering for each status

## Sources

### Primary (HIGH confidence)
- [portable-pty docs.rs](https://docs.rs/portable-pty/latest/portable_pty/trait.Child.html) -- `Child::process_id()` returns `Option<u32>`
- [kqueue crate docs.rs](https://docs.rs/kqueue/1.1.1/kqueue/) -- `Watcher::add_pid()`, EventFilter, FilterFlag API
- [kqueue FilterFlag docs](https://docs.rs/kqueue/1.1.1/kqueue/struct.FilterFlag.html) -- NOTE_FORK, NOTE_EXEC, NOTE_EXIT, NOTE_CHILD confirmed
- [macOS kqueue(2) man page](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/kqueue.2.html) -- EVFILT_PROC behavior
- [React ARIA Toast](https://react-aria.adobe.com/Toast) -- UNSTABLE_ToastQueue API, custom content types

### Secondary (MEDIUM confidence)
- [kqueue-sys darwin constants](https://docs.worrbase.com/rust/src/kqueue_sys/constants/darwin.rs.html) -- macOS-specific constant definitions
- [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference) -- `claude` binary name confirmed

### Tertiary (LOW confidence)
- Process tree depth for agent detection -- based on general knowledge of shell/node/python process hierarchy, needs empirical validation
- libproc crate API stability -- version 0.14 found, pre-1.0 status

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- kqueue crate verified on docs.rs with EVFILT_PROC support, portable-pty process_id() confirmed
- Architecture: HIGH -- follows established project patterns (Zustand + immer, Tauri events, std::thread, react-aria Dialog)
- Pitfalls: HIGH -- common kqueue/process monitoring issues well-documented in BSD literature
- Process name resolution: MEDIUM -- libproc crate is pre-1.0, needs version verification

**Research date:** 2026-04-02
**Valid until:** 2026-05-02 (stable domain, kqueue API unchanged for decades)
