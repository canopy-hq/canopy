# Phase 1: App Shell + Single Terminal - Research

**Researched:** 2026-04-01
**Domain:** Tauri v2 desktop app scaffolding, PTY terminal emulation, macOS native menus
**Confidence:** HIGH

## Summary

Phase 1 bootstraps the entire Superagent project from scratch -- no code exists yet. The deliverable is a Tauri v2 macOS app with a React+TypeScript frontend that displays a single terminal pane running the user's default shell. The terminal must handle 256-color, mouse events, and alternate screen apps (vim, htop). The macOS menu bar must provide standard menus. Error conditions surface as toast notifications.

The critical integration challenge is streaming PTY data from the Rust backend to xterm.js in the frontend. Tauri v2 provides **Channels** (not events) for high-throughput ordered data streaming -- this is the correct mechanism for terminal output. The PTY read loop runs on a spawned tokio task, reads chunks from portable-pty's `MasterPty::try_clone_reader()`, and sends them to the frontend via `Channel<Vec<u8>>`. xterm.js `Terminal.write(Uint8Array)` accepts raw bytes directly, avoiding UTF-16 conversion overhead.

**Primary recommendation:** Scaffold with `bun create tauri-app`, wire portable-pty to xterm.js via Tauri Channels (not events), use WebGL renderer from day one, and batch PTY output at 16ms intervals to avoid IPC flooding.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHELL-01 | Tauri v2 app with Rust backend and React + TypeScript frontend | Scaffolding via `bun create tauri-app`, Vite 8 config, project structure documented below |
| SHELL-02 | macOS menu bar: Superagent (About, Settings, Quit), Edit (Undo/Redo/Cut/Copy/Paste/Select All), Window (Minimize/Zoom/Close) | Tauri MenuBuilder/SubmenuBuilder/PredefinedMenuItem API documented with code examples |
| SHELL-03 | Error toast notifications (bottom-right, red accent, auto-dismiss 8s) | React ARIA UNSTABLE_Toast components with ToastQueue for programmatic control |
| TERM-01 | User can open a real shell session in a terminal pane (PTY + xterm.js WebGL) | portable-pty spawning + Tauri Channel streaming + xterm.js v6 WebGL addon pattern |
| TERM-07 | Terminal renders 256-color, mouse events, and alternate screen buffer correctly | xterm.js v6 handles all of these natively when PTY data is streamed as raw bytes |
</phase_requirements>

## Standard Stack

### Core (Phase 1 scope only)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tauri-apps/cli | 2.10.1 | Tauri CLI for dev/build | Official CLI, verified on npm |
| @tauri-apps/api | 2.10.1 | Frontend IPC (invoke, Channel, event) | Official frontend bindings |
| tauri (crate) | 2.10.3 | App framework + IPC backend | Verified on crates.io |
| portable-pty (crate) | 0.9.0 | PTY spawning + I/O | Powers WezTerm, battle-tested |
| @xterm/xterm | 6.0.0 | Terminal emulator UI | Latest major, canvas removed |
| @xterm/addon-webgl | 0.19.0 | GPU-accelerated rendering | Only renderer in v6 |
| @xterm/addon-fit | 0.11.0 | Auto-resize terminal to container | Required for responsive layout |
| @xterm/addon-web-links | 0.12.0 | Clickable URLs | Table stakes UX |
| react | 19.2.4 | UI framework | Stable, verified on npm |
| react-aria-components | 1.16.0 | Toast notifications (UNSTABLE_Toast) | Headless, accessible, project standard |
| zustand | 5.0.12 | Frontend state | Lightweight, works outside React |
| tailwindcss | 4.2.2 | Styling | v4 engine, CSS custom properties |
| vite | 8.0.3 | Bundler + dev server | Rolldown-based, Tauri-compatible |
| typescript | 5.x | Type safety | Standard |

### Rust Dependencies (Cargo.toml for Phase 1)
| Crate | Version | Purpose |
|-------|---------|---------|
| tauri | ~2.10 | App framework |
| portable-pty | 0.9 | PTY management |
| serde | 1, features=["derive"] | Serialization |
| serde_json | 1 | JSON serialization |
| tokio | 1, features=["full"] | Async runtime |

### Testing
| Library | Version | Purpose |
|---------|---------|---------|
| vitest | 4.1.2 | Frontend unit tests |
| @testing-library/react | 16.3.2 | Component testing |
| cargo test | built-in | Rust unit tests |

**Installation:**
```bash
# Scaffold
bun create tauri-app

# Frontend deps
bun add react react-dom react-aria-components zustand @xterm/xterm @xterm/addon-webgl @xterm/addon-fit @xterm/addon-web-links
bun add -d @tauri-apps/cli @tauri-apps/api typescript @types/react @types/react-dom tailwindcss @tailwindcss/vite vitest @testing-library/react @testing-library/dom jsdom
```

## Architecture Patterns

### Project Structure (Phase 1)
```
superagent/
├── src/                        # React frontend
│   ├── App.tsx                 # Root component
│   ├── main.tsx                # Entry point
│   ├── index.css               # Tailwind imports + CSS vars
│   ├── components/
│   │   ├── Terminal.tsx         # xterm.js wrapper component
│   │   └── ToastProvider.tsx    # Error toast region
│   ├── hooks/
│   │   └── useTerminal.ts      # PTY lifecycle hook
│   ├── lib/
│   │   └── pty.ts              # Tauri IPC wrappers for PTY commands
│   └── stores/
│       └── terminal.ts         # Zustand store for terminal state
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/           # Tauri v2 permission system
│   │   └── default.json
│   └── src/
│       ├── lib.rs              # Tauri setup, command registration, menu
│       ├── pty.rs              # PTY spawning, read/write, resize
│       └── error.rs            # Error types for IPC
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### Pattern 1: PTY Data Streaming via Tauri Channel

**What:** Stream PTY output from Rust to frontend using Tauri's Channel API (not events).
**When to use:** Always for terminal data. Events are fire-and-forget and not designed for high throughput.
**Why Channel over Event:** Channels are ordered, fast, and used internally by Tauri for streaming (child process output, downloads). Events evaluate JavaScript directly and are unsuitable for large/frequent payloads.

**Rust side:**
```rust
// Source: https://v2.tauri.app/develop/calling-rust/ (Channels section)
use tauri::ipc::Channel;
use portable_pty::{native_pty_system, PtySize, CommandBuilder, PtySystem};
use std::io::Read;
use std::sync::{Arc, Mutex};

#[tauri::command]
async fn spawn_terminal(
    on_output: Channel<Vec<u8>>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    // Spawn user's default shell
    let cmd = CommandBuilder::new_default_prog();
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let pid = child.process_id().unwrap_or(0);

    // Reader thread: read PTY output, batch at ~16ms, send via Channel
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(async move {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let _ = on_output.send(buf[..n].to_vec());
                }
                Err(_) => break,
            }
        }
    });

    Ok(pid)
}
```

**Frontend side:**
```typescript
// Source: https://v2.tauri.app/develop/calling-frontend/ (Channels section)
import { invoke, Channel } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';

const term = new Terminal({ /* options */ });

const onOutput = new Channel<number[]>();
onOutput.onmessage = (data: number[]) => {
    term.write(new Uint8Array(data));
};

await invoke('spawn_terminal', { onOutput });
```

### Pattern 2: Writing to PTY (Frontend -> Rust)

**What:** Send keyboard input from xterm.js to the PTY backend.
**Pattern:** Use a Tauri command with the PTY ID and data bytes.

```rust
#[tauri::command]
fn write_to_pty(pty_id: u32, data: Vec<u8>) -> Result<(), String> {
    // Look up writer from PtyManager, write data
    // Writer obtained from pair.master.take_writer()
    Ok(())
}
```

```typescript
// xterm.js onData sends string, convert to bytes
term.onData((data: string) => {
    const bytes = new TextEncoder().encode(data);
    invoke('write_to_pty', { ptyId, data: Array.from(bytes) });
});
```

### Pattern 3: PTY Manager (Rust State)

**What:** A struct that owns all PTY pairs, managed via `tauri::State<Mutex<PtyManager>>`.
**Why:** Multiple commands need access to PTY readers/writers. Tauri's managed state provides thread-safe access.

```rust
use std::collections::HashMap;
use std::sync::Mutex;
use portable_pty::MasterPty;

pub struct PtyManager {
    writers: HashMap<u32, Box<dyn std::io::Write + Send>>,
    // Children tracked for cleanup
    children: HashMap<u32, Box<dyn portable_pty::Child + Send>>,
}

// In lib.rs setup:
// app.manage(Mutex::new(PtyManager::new()));
```

### Pattern 4: macOS Menu Bar

**What:** Native menu with About, Edit (with standard clipboard shortcuts), Window submenus.
**Key macOS behavior:** First submenu becomes the app menu automatically. All items must be in submenus.

```rust
// Source: https://v2.tauri.app/learn/window-menu/
use tauri::menu::{MenuBuilder, SubmenuBuilder, PredefinedMenuItem};

fn setup_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let app_submenu = SubmenuBuilder::new(app, "Superagent")
        .about(None)
        .separator()
        .text("settings", "Settings...")  // Cmd+, handled by accelerator later
        .separator()
        .quit()
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_submenu, &edit_submenu, &window_submenu])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
```

### Pattern 5: Toast Notifications (React ARIA)

**What:** Error toasts in bottom-right, red accent, auto-dismiss 8s.
**Status:** React ARIA Toast is UNSTABLE_ prefixed but functional.

```tsx
// Source: https://react-aria.adobe.com/Toast
import {
    UNSTABLE_ToastRegion as ToastRegion,
    UNSTABLE_Toast as Toast,
    UNSTABLE_ToastQueue as ToastQueue,
    UNSTABLE_ToastContent as ToastContent,
    Text,
    Button
} from 'react-aria-components';

// Global queue -- can be called from anywhere (Zustand actions, IPC handlers)
const toastQueue = new ToastQueue<{ title: string; description?: string }>({
    maxVisibleToasts: 5,
});

// Expose for use outside React
export function showErrorToast(title: string, description?: string) {
    toastQueue.add({ title, description }, { timeout: 8000 });
}

// Render at app root
function ErrorToastRegion() {
    return (
        <ToastRegion queue={toastQueue}>
            {({ toast }) => (
                <Toast toast={toast} className="error-toast">
                    <ToastContent>
                        <Text slot="title">{toast.content.title}</Text>
                        {toast.content.description && (
                            <Text slot="description">{toast.content.description}</Text>
                        )}
                    </ToastContent>
                    <Button slot="close">Dismiss</Button>
                </Toast>
            )}
        </ToastRegion>
    );
}
```

### Anti-Patterns to Avoid
- **Using Tauri events for PTY streaming:** Events evaluate JS directly, not designed for high throughput. Use Channels.
- **Spawning PTY on main thread:** Block the Tauri event loop. Always use `tauri::async_runtime::spawn` or `tokio::spawn` from within async commands.
- **Not batching PTY output:** Sending every byte individually floods IPC. Read in 4KB chunks, consider 16ms batching window if needed (can add in Phase 2 if perf issues arise).
- **Using `tokio::spawn` in window listeners:** Panics in Tauri v2. Use `tauri::async_runtime::spawn` instead.
- **Forgetting `drop(pair.slave)` after spawn:** On some platforms, the slave must be dropped after spawning or reads on master may hang.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal emulation | Custom terminal renderer | xterm.js v6 + WebGL addon | Thousands of VT escape codes, mouse protocols, 256-color/truecolor |
| PTY management | Raw libc forkpty/openpty | portable-pty | Cross-platform, handles ConPTY on Windows, signal handling |
| macOS menu bar | Custom window chrome | Tauri MenuBuilder + PredefinedMenuItem | Native OS integration, keyboard shortcuts, accessibility |
| Toast notifications | Custom notification system | React ARIA UNSTABLE_Toast | ARIA alertdialog pattern, keyboard navigation, timer pause on focus |
| IPC streaming | Custom WebSocket/HTTP bridge | Tauri Channel | Built-in ordering, optimized serialization, no extra deps |

## Common Pitfalls

### Pitfall 1: PTY Slave Not Dropped After Spawn
**What goes wrong:** Reads from `master.try_clone_reader()` hang indefinitely.
**Why it happens:** On Unix, the slave fd must be closed in the parent process after the child inherits it. If the parent holds the slave, the master never gets EOF.
**How to avoid:** Call `drop(pair.slave)` immediately after `pair.slave.spawn_command()`.
**Warning signs:** Terminal appears to start but no output appears.

### Pitfall 2: IPC Bottleneck on Terminal Data
**What goes wrong:** Terminal output is laggy, especially with fast-scrolling commands (ls -R, cat large_file).
**Why it happens:** Each IPC message has serialization overhead. Sending tiny chunks or per-byte data saturates the bridge.
**How to avoid:** Read in 4KB chunks from PTY. If still slow, add a 16ms batching window that accumulates output before sending.
**Warning signs:** UI freezes during `cat /dev/urandom | head -1000` or similar high-output commands.

### Pitfall 3: xterm.js WebGL Context Lost
**What goes wrong:** Terminal goes blank, WebGL errors in console.
**Why it happens:** GPU context can be reclaimed by the OS under memory pressure. More relevant in Phase 2 with multiple terminals, but handle from day one.
**How to avoid:** Listen for `webgl.onContextLoss` event. Re-initialize the addon or fall back gracefully.
**Warning signs:** Terminal content disappears after app has been in background.

### Pitfall 4: xterm.js v6 Import Paths
**What goes wrong:** Build errors or runtime "module not found".
**Why it happens:** xterm.js v6 uses `@xterm/xterm` package scope (not old `xterm` package). Addons are `@xterm/addon-*`.
**How to avoid:** Always use `@xterm/xterm`, `@xterm/addon-webgl`, etc.
**Warning signs:** Import resolution failures.

### Pitfall 5: Tauri v2 Capability Permissions
**What goes wrong:** IPC commands fail silently or throw permission errors at runtime.
**Why it happens:** Tauri v2 introduced a capability-based permission system. Commands must be declared in `src-tauri/capabilities/default.json`.
**How to avoid:** Add all custom commands to capabilities. The `core:default` permission covers most basics.
**Warning signs:** `invoke()` calls reject with permission errors.

### Pitfall 6: Terminal Resize Not Propagated to PTY
**What goes wrong:** Terminal UI resizes but shell output still wraps at old column width.
**Why it happens:** xterm.js resize and PTY resize are separate operations. Must sync both.
**How to avoid:** On container resize -> `fitAddon.fit()` -> read `term.cols`/`term.rows` -> invoke `resize_pty` command -> call `master.resize()`.
**Warning signs:** Line wrapping is wrong after window resize.

## Code Examples

### Vite Configuration for Tauri v2
```typescript
// vite.config.ts
// Source: https://v2.tauri.app/start/frontend/vite/
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
    plugins: [react(), tailwindcss()],
    clearScreen: false,
    server: {
        port: 5173,
        strictPort: true,
        host: host || false,
        hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
        watch: { ignored: ['**/src-tauri/**'] },
    },
    envPrefix: ['VITE_', 'TAURI_ENV_*'],
    build: {
        target: 'safari13',
        minify: !process.env.TAURI_ENV_DEBUG ? 'esbuild' : false,
        sourcemap: !!process.env.TAURI_ENV_DEBUG,
    },
});
```

### xterm.js React Component Pattern
```tsx
// src/components/Terminal.tsx
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';

export function TerminalView() {
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<Terminal | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
            theme: {
                background: '#1a1a2e',
                foreground: '#e0e0e0',
            },
            allowProposedApi: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());

        term.open(containerRef.current);

        // WebGL must be loaded AFTER open()
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
            webglAddon.dispose();
            // Could reload or fall back
        });
        term.loadAddon(webglAddon);

        fitAddon.fit();
        termRef.current = term;

        // Handle container resize
        const resizeObserver = new ResizeObserver(() => fitAddon.fit());
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
            term.dispose();
        };
    }, []);

    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
```

### Tauri App Entry Point (Rust)
```rust
// src-tauri/src/lib.rs
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            setup_menu(app)?;
            Ok(())
        })
        .manage(std::sync::Mutex::new(pty::PtyManager::new()))
        .invoke_handler(tauri::generate_handler![
            pty::spawn_terminal,
            pty::write_to_pty,
            pty::resize_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| xterm.js v5 + canvas | xterm.js v6 + WebGL only | 2025 | Canvas renderer removed; must use `@xterm/addon-webgl` |
| Tauri events for streaming | Tauri Channels | Tauri 2.0 | Channels are ordered, faster, purpose-built for streaming |
| `xterm` npm package | `@xterm/xterm` scoped package | xterm.js v5+ | Old package name deprecated |
| Tauri v1 allowlist | Tauri v2 capabilities | Tauri 2.0 | Must declare permissions in `capabilities/default.json` |
| `tokio::spawn` in listeners | `tauri::async_runtime::spawn` | Tauri 2.0 | Direct tokio::spawn panics in window listeners |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.2 (frontend), cargo test (Rust) |
| Config file | None -- Wave 0 must create `vitest.config.ts` and test setup |
| Quick run command | `bun run vitest run --reporter=verbose` |
| Full suite command | `bun run vitest run && cd src-tauri && cargo test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHELL-01 | Tauri app builds and runs | smoke | `cd src-tauri && cargo build` | N/A (build check) |
| SHELL-02 | Menu bar has correct submenus | unit (Rust) | `cd src-tauri && cargo test menu` | Wave 0 |
| SHELL-03 | Toast shows error, auto-dismisses | unit (React) | `bun run vitest run --reporter=verbose -- toast` | Wave 0 |
| TERM-01 | PTY spawns shell, data streams to frontend | unit (Rust) | `cd src-tauri && cargo test pty` | Wave 0 |
| TERM-07 | Terminal renders 256-color/mouse/alt screen | manual-only | Manual: run `htop`, `vim`, color test scripts | N/A (visual) |

### Sampling Rate
- **Per task commit:** `bun run vitest run --reporter=verbose`
- **Per wave merge:** `bun run vitest run && cd src-tauri && cargo test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `vitest.config.ts` -- Vitest configuration with jsdom environment
- [ ] `src/test-setup.ts` -- Testing library setup
- [ ] `src/components/__tests__/Terminal.test.tsx` -- Terminal component mount/dispose
- [ ] `src/components/__tests__/ToastProvider.test.tsx` -- Toast display and auto-dismiss
- [ ] `src-tauri/src/pty.rs` -- Include `#[cfg(test)] mod tests` for PTY spawn/write/resize

## Open Questions

1. **Tauri Channel binary data format**
   - What we know: `Channel<Vec<u8>>` works for byte streaming. Frontend receives `number[]`.
   - What's unclear: Whether there's a more efficient way to receive as `Uint8Array` directly without the array conversion.
   - Recommendation: Start with `Vec<u8>` / `number[]` -> `new Uint8Array()`, optimize if profiling shows overhead.

2. **Default shell detection on macOS**
   - What we know: `CommandBuilder::new_default_prog()` uses `SHELL` env var or `/etc/passwd`.
   - What's unclear: Whether this correctly picks up shells set via `chsh` vs `dscl` on modern macOS.
   - Recommendation: Use `CommandBuilder::new_default_prog()` initially; if issues arise, fall back to reading `SHELL` env var explicitly.

3. **Vite 8 + Tauri v2 compatibility**
   - What we know: Tauri docs show Vite 5.x config. Community projects use Vite 6+. Vite 8 uses Rolldown engine.
   - What's unclear: Whether Vite 8's Rolldown engine has any edge cases with Tauri's env variables or build targets.
   - Recommendation: Proceed with Vite 8 as planned. The Vite config is minimal and standard. Fall back to Vite 6 only if build issues emerge.

## Sources

### Primary (HIGH confidence)
- [Tauri v2 Menu Bar docs](https://v2.tauri.app/learn/window-menu/) -- MenuBuilder, SubmenuBuilder, PredefinedMenuItem API
- [Tauri v2 Calling Rust](https://v2.tauri.app/develop/calling-rust/) -- Commands, Channel streaming API
- [Tauri v2 Calling Frontend](https://v2.tauri.app/develop/calling-frontend/) -- Events, Channel frontend API
- [Tauri v2 Vite setup](https://v2.tauri.app/start/frontend/vite/) -- vite.config.ts configuration
- [Tauri v2 IPC concepts](https://v2.tauri.app/concept/inter-process-communication/) -- Events vs Channels distinction
- [portable-pty docs.rs](https://docs.rs/portable-pty/latest/portable_pty/) -- PtySystem, CommandBuilder, MasterPty API
- [React ARIA Toast](https://react-aria.adobe.com/Toast) -- UNSTABLE_Toast, ToastQueue, ToastRegion
- [xterm.js encoding guide](https://xtermjs.org/docs/guides/encoding/) -- Uint8Array vs string write performance
- npm/crates.io version verification (all versions confirmed 2026-04-01)

### Secondary (MEDIUM confidence)
- [Tauri + Async Rust Process](https://rfdonnelly.github.io/posts/tauri-async-rust-process/) -- tokio::mpsc pattern for async streaming
- [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal) -- Reference architecture for Tauri + xterm.js + portable-pty
- [Tauri GitHub Discussion #7146](https://github.com/tauri-apps/tauri/discussions/7146) -- High-rate IPC data sending

### Tertiary (LOW confidence)
- Vite 8 + Tauri v2 compatibility -- no official confirmation, extrapolated from Vite 6 compatibility

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all versions verified against npm/crates.io registries
- Architecture: HIGH -- patterns verified from official Tauri docs and portable-pty docs
- Pitfalls: HIGH -- sourced from official docs, GitHub issues, and known Tauri v2 migration notes

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable ecosystem, 30 days)
