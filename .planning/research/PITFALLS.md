# Domain Pitfalls

**Domain:** Tauri v2 desktop terminal emulator with PTY management and AI agent monitoring
**Researched:** 2026-03-31

## Critical Pitfalls

Mistakes that cause rewrites or major issues.

### Pitfall 1: IPC Bottleneck on Terminal Data Streaming

**What goes wrong:** Terminal output is high-throughput, continuous binary data. Tauri's IPC serializes all data as strings (JSON) for the webview bridge. Naive implementations send every PTY output chunk through `invoke` or `emit`, causing visible lag, dropped frames, and sluggish terminal feel -- especially with multiple panes running simultaneously.

**Why it happens:** Tauri's IPC was designed for request/response patterns, not continuous streaming. On macOS, binary IPC benchmarks show ~5ms per call, which compounds rapidly when a PTY emits thousands of chunks per second (e.g., `cat` of a large file, build output).

**Consequences:** Terminal feels laggy compared to native terminals. Users running `cargo build` or AI agent output across 4+ panes see visible stutter. The app loses its core value proposition of "real terminals."

**Prevention:**
- Use Tauri's event system (`emit`/`listen`) for PTY-to-frontend streaming instead of command invoke
- Batch PTY output on the Rust side -- accumulate chunks over a short window (e.g., 16ms / one frame) before sending to frontend
- Consider a custom protocol handler (`register_uri_scheme_protocol`) for binary data if event-based approach is insufficient
- Implement backpressure: if the frontend can't consume fast enough, buffer in Rust rather than flooding the IPC channel

**Detection:** Run `find / -name "*.rs" 2>/dev/null` or `cat` a 10MB file in a terminal pane. If output visibly stutters or freezes, IPC is the bottleneck. Profile with Tauri DevTools network tab to see event frequency.

**Phase:** Must be addressed in the initial PTY-to-xterm.js integration (Phase 1/2). Retrofitting batching onto a naive per-chunk architecture is painful.

---

### Pitfall 2: xterm.js / PTY Resize Race Condition

**What goes wrong:** When a split pane is resized (dragging a divider), the xterm.js terminal and the backend PTY must agree on the new dimensions (cols x rows). Since the resize propagates asynchronously (DOM resize -> FitAddon.fit() -> IPC call -> PTY resize), data written by the shell between the old and new size assumptions produces garbled output -- wrapped lines, misaligned prompts, broken TUI apps (vim, htop).

**Why it happens:** The PTY continues emitting data formatted for the old terminal size while the resize message is in flight. xterm.js is already rendering at the new size. This mismatch corrupts the display, especially for full-screen TUI programs.

**Consequences:** Every split-pane drag or window resize produces visual artifacts. TUI programs (vim, tmux) inside the terminal break during resize. Users lose trust in the terminal's correctness.

**Prevention:**
- Debounce resize events aggressively (150-200ms) before calling `FitAddon.fit()` and propagating to the PTY
- Use `ResizeObserver` on the terminal container element, not window resize events
- Send PTY resize (SIGWINCH equivalent via `portable-pty`) only after debounce settles
- For TUI-heavy workflows, consider briefly pausing PTY reads during resize, applying new size, then resuming (complex but eliminates the race entirely)
- Test with `vim`, `htop`, and `less` inside terminals during rapid resize

**Detection:** Open vim in a terminal pane, rapidly drag a split divider. If content garbles or vim shows wrong dimensions, the race condition is present.

**Phase:** Must be solved during split-pane implementation. Cannot defer -- it affects every resize interaction.

---

### Pitfall 3: WebGL Context Exhaustion with Multiple Terminal Panes

**What goes wrong:** Each xterm.js instance with the WebGL addon creates its own WebGL context. Browsers (including WebKit on macOS) have a hard limit on concurrent WebGL contexts (typically 8-16). When users open many terminal panes across tabs, older contexts are silently dropped, causing terminals to go blank or fall back to the slower canvas renderer without warning.

**Why it happens:** The WebGL addon allocates GPU textures for the glyph atlas per terminal instance. macOS WebKit is particularly aggressive about reclaiming WebGL contexts under memory pressure. A user with 4 tabs x 4 split panes = 16 terminal instances will hit the limit.

**Consequences:** Terminals silently go blank. Users think the app crashed. Performance degrades unpredictably as some terminals fall back to canvas rendering while others use WebGL.

**Prevention:**
- Listen for `webglcontextlost` events on each terminal and handle gracefully (show overlay message, attempt restore)
- Implement a context budget: only WebGL-render the visible/focused terminals, use canvas renderer for background tabs
- When a tab is hidden, dispose the WebGL addon and re-attach it when the tab becomes visible
- Cap maximum simultaneous WebGL contexts and queue excess terminals for canvas rendering
- Test with 16+ terminal instances open simultaneously

**Detection:** Open 10+ terminal panes, switch between tabs rapidly. If any terminals show blank/black screens, WebGL contexts are being lost.

**Phase:** Must be designed into the tab/pane management system from the start. Retrofitting context management onto a "every terminal gets WebGL" architecture requires significant refactoring.

---

### Pitfall 4: PTY Lifecycle and Zombie Process Leaks

**What goes wrong:** When a terminal pane is closed or a tab is destroyed, the PTY child process (shell) and its entire process tree (including running AI agents) are not properly terminated. Over time, zombie processes accumulate, consuming system resources. Worse, if the app crashes, all spawned PTYs become orphans.

**Why it happens:** `portable-pty` spawns real OS processes. Closing the PTY master fd signals the child, but does not guarantee the child or its descendants terminate. Shell processes may ignore SIGHUP. AI agents running inside the shell have their own process trees. React component unmounting does not automatically trigger Rust-side cleanup.

**Consequences:** Users notice high CPU/memory usage from orphaned processes after closing panes. AI agents continue running (and potentially making changes) after the user thought they closed the terminal. On app crash, dozens of orphaned shells persist.

**Prevention:**
- Implement a PTY registry in Rust that tracks all spawned PTYs and their child PIDs
- On pane close: send SIGHUP to the process group, wait briefly, then SIGKILL if still alive
- On app exit (including crash handler via `std::panic::set_hook`): iterate registry and kill all PTYs
- Use process groups (`setsid` or `setpgid`) when spawning PTYs so the entire tree can be signaled at once
- Implement a periodic reaper that checks for zombie children (`waitpid` with `WNOHANG`)
- Store PTY-to-pane mapping so the frontend can query which processes are still running

**Detection:** Close 10 terminal panes, then check `ps aux | grep -E "(zsh|bash|fish)"` for orphaned shell processes. If counts increase after closing panes, cleanup is broken.

**Phase:** Must be built into PTY spawning from day one. The PTY registry is a foundational component.

---

### Pitfall 5: Tauri v2 Capability/Permission Misconfiguration

**What goes wrong:** Tauri v2 introduced a fine-grained capability system where commands are denied by default. A terminal app needs shell:execute, fs access, process spawning, and event permissions. Developers forget to declare capabilities, hit cryptic "not allowed" runtime errors, or over-permit with wildcard capabilities that defeat the security model.

**Why it happens:** The capability system is new in Tauri v2 (didn't exist in v1). Each plugin (shell, fs, process) requires explicit permission grants per window. The error messages when a capability is missing are not always clear. All capabilities in the `capabilities/` directory are auto-enabled, but once you explicitly configure any in `tauri.conf.json`, only those are used.

**Consequences:** Features silently fail at runtime. PTY spawning works in dev but breaks in production builds. Or worse, developers grant `allow-all` permissions that expose shell access to any JavaScript running in the webview.

**Prevention:**
- Define a dedicated capability file for the main window with exactly the permissions needed: shell spawning, fs read (for workspace scanning), process management
- Test in release mode early (not just `tauri dev`) -- permission behavior can differ
- Never use wildcard/allow-all permissions for shell or process capabilities
- Document the required capabilities in the project README
- Add a startup self-check that verifies critical capabilities are available

**Detection:** Build a release binary and test all features. If PTY spawning or file access fails only in release mode, capability configuration is the issue.

**Phase:** Must be set up correctly when scaffolding the Tauri app. Should be revisited whenever new commands are added.

---

## Moderate Pitfalls

### Pitfall 6: xterm.js Disposal Memory Leaks in Split Panes

**What goes wrong:** When closing a split pane, the xterm.js `Terminal` instance, its addons (WebGL, FitAddon), and event listeners must all be explicitly disposed. React's component lifecycle (`useEffect` cleanup) is not sufficient if references are held elsewhere (e.g., in a pane registry, event bus, or IPC listener).

**Prevention:**
- Create a dedicated `useTerminal` hook that manages the full lifecycle: create Terminal -> attach addons -> register IPC listeners -> return cleanup function that disposes everything in reverse order
- Dispose addons before disposing the terminal (WebGL addon must release GPU resources first)
- Remove all `onData`, `onResize`, and IPC event listeners in cleanup
- Use WeakRef or explicit nulling for any registry that holds terminal references
- Test with repeated open/close of panes while monitoring memory in DevTools

**Phase:** Build into the terminal component from the start. The hook pattern prevents ad-hoc disposal scattered across components.

---

### Pitfall 7: FitAddon Erratic Behavior in Flexbox/CSS Grid Layouts

**What goes wrong:** `FitAddon.fit()` calculates terminal dimensions from the container element's size. In flexbox or CSS grid layouts (common for split panes), the container size may not be settled when `fit()` is called, producing incorrect dimensions. The terminal oscillates between sizes or doesn't fill its container.

**Prevention:**
- Call `fit()` only after the container has a stable, non-zero size (check with `getBoundingClientRect()`)
- Use `ResizeObserver` instead of calling `fit()` on mount -- the observer fires when the layout is stable
- Debounce `fit()` calls (200ms) to avoid oscillation during layout transitions
- Set `overflow: hidden` on the terminal container to prevent scrollbar-induced resize loops
- Avoid percentage-based heights without a fixed-height ancestor -- xterm.js needs a concrete pixel size

**Phase:** Address during split-pane layout implementation. Test with deeply nested splits (3+ levels).

---

### Pitfall 8: git2 Crate Incomplete Worktree Support

**What goes wrong:** The `git2` crate (Rust bindings for libgit2) documents itself as "likely lacking some bindings." Worktree operations work for basic add/list/remove but may not cover all edge cases (pruning locked worktrees, worktrees in unusual states, bare repo worktrees). Developers hit runtime panics or silent failures on uncommon git states.

**Prevention:**
- Test `git2` worktree operations against real-world repo states early: repos with dozens of worktrees, locked worktrees, worktrees on detached HEAD, stale worktree references
- Have a fallback to `std::process::Command` calling `git` CLI for any operation where `git2` is insufficient -- wrap both behind a trait so the fallback is seamless
- Pin `git2` version and test before upgrading -- libgit2 upstream changes can break worktree behavior
- For the agent detection use case, process tree inspection via sysctl/proc is more reliable than trying to detect agents through git state

**Phase:** Validate during the git integration phase. Build the trait abstraction early so CLI fallback is trivial to add.

---

### Pitfall 9: Agent Detection False Positives/Negatives via Process Polling

**What goes wrong:** Detecting AI agents by polling the process tree every 2 seconds and matching against a `known_agents` list produces both false positives (user has a process named "claude" that isn't Claude Code) and false negatives (agent binary name changes between versions, or agent runs as a subprocess with a generic name like "node").

**Prevention:**
- Match on full command line (`/proc/*/cmdline` equivalent), not just process name
- Use the PTY's child PID as the root for tree inspection -- only look at processes descended from the terminal's shell, not system-wide
- Make the `known_agents` patterns configurable with regex support, not just exact names
- Include common agent binary patterns: `claude`, `aider`, `codex`, `cursor-agent` with version-resilient matching
- Log detection events so users can debug false positives/negatives
- On macOS, use `sysctl KERN_PROC` or `proc_pidinfo` for efficient process tree walking -- avoid shelling out to `ps`

**Phase:** Agent detection phase. Design the matching engine to be easily extended as new agents appear.

---

### Pitfall 10: State Serialization Crashes on App Restore

**What goes wrong:** Session persistence (saving layout, tabs, pane arrangement, scroll position) fails silently or crashes on restore when the saved state references entities that no longer exist (deleted worktree, removed repo, changed branch). The app fails to start or starts in a broken state.

**Prevention:**
- Validate all references during restore: does the workspace path still exist? Does the branch still exist? Is the worktree still valid?
- Implement graceful degradation: if a saved tab references a deleted worktree, show a placeholder pane with an error message instead of crashing
- Version the state schema so old state files can be migrated or discarded on schema change
- Use Tauri's `tauri-plugin-store` for atomic state persistence -- avoid manual file I/O
- Save state periodically (every 30s) and on clean exit, not only on exit -- crash recovery needs the periodic saves
- In Rust, use `RwLock` not `Mutex` for state that is read-heavy (layout queries) and rarely written (layout changes)

**Phase:** Session persistence phase. Build validation into the restore path from the start.

---

## Minor Pitfalls

### Pitfall 11: macOS WebKit CSS/Rendering Quirks

**What goes wrong:** Tauri uses WebKit on macOS, not Chromium. CSS features that work in Chrome DevTools during development may render differently in the actual app. Specific known issues: CSS backdrop-filter performance, subpixel rendering differences, and font rendering variations.

**Prevention:**
- Test in the actual Tauri webview regularly, not just a browser
- Avoid bleeding-edge CSS features -- stick to well-supported properties
- Test with all 8 built-in themes for color rendering correctness
- WebKit's DevTools can be enabled via `tauri.conf.json` `devtools: true` in debug builds

---

### Pitfall 12: Blocking the Rust Async Runtime with PTY I/O

**What goes wrong:** PTY reads are blocking I/O. If PTY read loops run on the Tokio async runtime (which Tauri uses internally), they block the entire runtime, freezing IPC, event handling, and all other async operations.

**Prevention:**
- Always use `tokio::task::spawn_blocking` for PTY read loops, never `tokio::spawn`
- Create dedicated OS threads for PTY I/O if `spawn_blocking`'s thread pool is insufficient for many concurrent terminals
- Keep the async runtime free for IPC, events, and git operations

---

### Pitfall 13: Shell Environment Inheritance

**What goes wrong:** PTYs spawned by Tauri inherit the app's environment, not the user's interactive shell environment. PATH, shell aliases, conda environments, nvm node versions, and other interactive shell setup is missing. Terminals feel broken because tools the user expects are not available.

**Prevention:**
- Spawn the user's configured shell (from settings or `$SHELL`) as a login shell (`-l` flag) so `.zshrc`/`.bashrc`/`.bash_profile` are sourced
- Set `TERM=xterm-256color` in the PTY environment
- Inherit `HOME`, `USER`, `SHELL`, `PATH` from the system, then let the login shell overlay its own
- Test with users who use nvm, pyenv, conda, or other version managers -- these are the most common "my tools are missing" reports

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| App shell + Tauri setup | Capability misconfiguration (#5) | Define permissions file early, test release builds |
| PTY integration | IPC bottleneck (#1), blocking runtime (#12), shell env (#13) | Batch output, use spawn_blocking, spawn login shell |
| xterm.js rendering | WebGL context limits (#3), disposal leaks (#6) | Context budget system, lifecycle hook |
| Split pane system | Resize race (#2), FitAddon erratic (#7) | Debounce 200ms, ResizeObserver, test with TUI apps |
| Tab/session management | State restore crashes (#10), process leaks (#4) | Validate on restore, PTY registry with kill-on-close |
| Git integration | git2 worktree gaps (#8) | Trait abstraction with CLI fallback |
| Agent detection | False positives/negatives (#9) | Scoped to PTY child tree, regex patterns, logging |
| Theming/UI polish | WebKit rendering (#11) | Test in actual webview, not browser |

## Sources

- [Tauri IPC Improvements Discussion](https://github.com/tauri-apps/tauri/discussions/5690)
- [Tauri IPC high-rate data streaming](https://github.com/tauri-apps/tauri/discussions/7146)
- [xterm.js WebGL memory leak #3889](https://github.com/xtermjs/xterm.js/issues/3889)
- [xterm.js Terminal resize roundtrip #1914](https://github.com/xtermjs/xterm.js/issues/1914)
- [xterm.js disposal race condition #5181](https://github.com/xtermjs/xterm.js/issues/5181)
- [xterm.js terminals retained forever #1341](https://github.com/xtermjs/xterm.js/issues/1341)
- [xterm.js FitAddon erratic resize #3584](https://github.com/xtermjs/xterm.js/issues/3584)
- [xterm.js parser worker isolation #3368](https://github.com/xtermjs/xterm.js/issues/3368)
- [Tauri v2 Permissions docs](https://v2.tauri.app/security/permissions/)
- [Tauri v2 Capabilities docs](https://v2.tauri.app/security/capabilities/)
- [Tauri State Management docs](https://v2.tauri.app/develop/state-management/)
- [Tauri Store Plugin](https://v2.tauri.app/plugin/store/)
- [Tauri Window State Plugin](https://v2.tauri.app/plugin/window-state/)
- [portable-pty docs](https://docs.rs/portable-pty)
- [portable-pty output hangs discussion](https://users.rust-lang.org/t/rust-pty-output-hangs-when-trying-to-read-command-output-in-terminal-emulator/102873)
- [tauri-plugin-pty](https://github.com/Tnze/tauri-plugin-pty)
- [Tauri vs Electron real-world comparison](https://www.gethopp.app/blog/tauri-vs-electron)
- [WebKit instability discussion](https://github.com/orgs/tauri-apps/discussions/8524)
- [git2 crate docs](https://docs.rs/git2/latest/git2/)
