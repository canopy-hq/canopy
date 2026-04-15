use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use notify::{recommended_watcher, Event, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::Emitter;
use tokio::sync::{mpsc, Semaphore};

use crate::git::ProjectPollState;

// ── Types ──────────────────────────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectStateChangedPayload {
    pub project_path: String,
    pub state: ProjectPollState,
}

// ── State ──────────────────────────────────────────────────────────────

pub struct FsWatcherState {
    watchers: HashMap<String, ProjectWatcher>,
    /// Shared flag: when true, debounce tasks skip recomputation.
    paused: Arc<AtomicBool>,
    /// Caps concurrent spawn_blocking git operations across all watchers.
    semaphore: Arc<Semaphore>,
}

struct ProjectWatcher {
    /// Dropping this stops FSEvents for this project.
    _watcher: notify::RecommendedWatcher,
    /// Signal the debounce task to shut down (dropping the sender cancels).
    _cancel: tokio::sync::oneshot::Sender<()>,
}

impl FsWatcherState {
    pub fn new() -> Self {
        Self {
            watchers: HashMap::new(),
            paused: Arc::new(AtomicBool::new(false)),
            semaphore: Arc::new(Semaphore::new(6)),
        }
    }
}

// ── Path filtering ─────────────────────────────────────────────────────

/// Fast filter for the notify callback. Returns true if the event should
/// be IGNORED (not forwarded to the debounce task).
///
/// For `.git/` internal paths, uses an allowlist of entries that affect
/// diff/branch state. For working-tree paths, lets everything through —
/// the 250ms debounce coalesces rapid events, and `poll_project_state_sync`
/// diffs git trees so gitignored files don't affect the result.
fn should_ignore_event(path: &Path, repo_root: &Path) -> bool {
    let relative = match path.strip_prefix(repo_root) {
        Ok(r) => r,
        Err(_) => return true,
    };

    let mut components = relative.components().peekable();
    let first = match components.peek() {
        Some(c) => c.as_os_str(),
        None => return true,
    };

    // Not under .git/ — working-tree file, always forward
    if first != ".git" {
        return false;
    }

    // Under .git/ — allowlist only entries that affect diff/branch state
    components.next(); // consume ".git"
    let second = match components.next() {
        Some(c) => c.as_os_str(),
        None => return false, // .git dir itself changed
    };

    let allowed = matches!(
        second.to_str(),
        Some(
            "HEAD"
                | "index"
                | "refs"
                | "MERGE_HEAD"
                | "REBASE_HEAD"
                | "CHERRY_PICK_HEAD"
                | "REVERT_HEAD"
                | "worktrees"
                | "packed-refs"
        )
    );
    !allowed
}

// ── Debounce task ──────────────────────────────────────────────────────

/// Spawns a long-lived task that:
/// 1. Waits for FS event signals
/// 2. Debounces for 250ms
/// 3. Recomputes project state via `poll_project_state_sync`
/// 4. Emits `project-state-changed` only if state actually changed
fn spawn_debounce_task(
    project_path: String,
    mut rx: mpsc::Receiver<()>,
    mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    paused: Arc<AtomicBool>,
    semaphore: Arc<Semaphore>,
    app_handle: tauri::AppHandle,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let mut prev_state: Option<ProjectPollState> = None;

        loop {
            // Wait for first event signal OR cancellation
            tokio::select! {
                biased;
                _ = &mut cancel_rx => break,
                msg = rx.recv() => {
                    if msg.is_none() { break; }
                }
            }

            // Debounce: drain further events for 250ms
            let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(250);
            loop {
                tokio::select! {
                    biased;
                    _ = &mut cancel_rx => return,
                    _ = rx.recv() => {},
                    _ = tokio::time::sleep_until(deadline) => break,
                }
            }

            // Skip recomputation if app is backgrounded
            if paused.load(Ordering::Relaxed) {
                continue;
            }

            // Cap concurrent git operations
            let _permit = match semaphore.acquire().await {
                Ok(p) => p,
                Err(_) => break,
            };

            let path = project_path.clone();
            let result =
                tokio::task::spawn_blocking(move || crate::git::poll_project_state_sync(&path))
                    .await;

            let state = match result {
                Ok(Ok(s)) => s,
                Ok(Err(e)) => {
                    eprintln!("[fs-watcher] poll failed for {project_path}: {e}");
                    continue;
                }
                Err(e) => {
                    eprintln!("[fs-watcher] task panicked for {project_path}: {e}");
                    continue;
                }
            };

            // Emit only if state changed
            let changed = match &prev_state {
                Some(old) => !project_states_equal(old, &state),
                None => true,
            };

            if changed {
                prev_state = Some(state.clone());
                let payload = ProjectStateChangedPayload {
                    project_path: project_path.clone(),
                    state,
                };
                if let Err(e) = app_handle.emit("project-state-changed", &payload) {
                    eprintln!("[fs-watcher] emit failed: {e}");
                }
            }
        }
    })
}

/// Compare two `ProjectPollState` values for equality.
fn project_states_equal(a: &ProjectPollState, b: &ProjectPollState) -> bool {
    if a.head_oid != b.head_oid {
        return false;
    }
    if a.branches.len() != b.branches.len() {
        return false;
    }
    for (ab, bb) in a.branches.iter().zip(b.branches.iter()) {
        if ab.name != bb.name || ab.is_head != bb.is_head {
            return false;
        }
    }
    if a.worktree_branches.len() != b.worktree_branches.len() {
        return false;
    }
    for (k, v) in &a.worktree_branches {
        if b.worktree_branches.get(k) != Some(v) {
            return false;
        }
    }
    if a.diff_stats.len() != b.diff_stats.len() {
        return false;
    }
    for (k, v) in &a.diff_stats {
        match b.diff_stats.get(k) {
            Some(bv) if bv.additions == v.additions && bv.deletions == v.deletions => {}
            _ => return false,
        }
    }
    true
}

// ── Tauri commands ─────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_project_watcher(
    project_path: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<FsWatcherState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;

    if guard.watchers.contains_key(&project_path) {
        return Ok(());
    }

    let repo_root = PathBuf::from(&project_path);

    // Channel: notify callback → debounce task
    let (debounce_tx, debounce_rx) = mpsc::channel::<()>(16);

    // Cancellation: dropping cancel_tx signals the task to exit
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();

    // Create the filesystem watcher
    let root = repo_root.clone();
    let mut watcher = recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let all_ignored = event.paths.iter().all(|p| should_ignore_event(p, &root));
            if !all_ignored {
                let _ = debounce_tx.try_send(());
            }
        }
    })
    .map_err(|e| format!("failed to create watcher for {project_path}: {e}"))?;

    watcher
        .watch(&repo_root, RecursiveMode::Recursive)
        .map_err(|e| format!("failed to watch {project_path}: {e}"))?;

    spawn_debounce_task(
        project_path.clone(),
        debounce_rx,
        cancel_rx,
        guard.paused.clone(),
        guard.semaphore.clone(),
        app,
    );

    guard.watchers.insert(
        project_path,
        ProjectWatcher {
            _watcher: watcher,
            _cancel: cancel_tx,
        },
    );

    Ok(())
}

#[tauri::command]
pub async fn stop_project_watcher(
    project_path: String,
    state: tauri::State<'_, std::sync::Mutex<FsWatcherState>>,
) -> Result<(), String> {
    let mut guard = state.lock().map_err(|e| e.to_string())?;
    guard.watchers.remove(&project_path);
    Ok(())
}

#[tauri::command]
pub async fn pause_watchers(
    state: tauri::State<'_, std::sync::Mutex<FsWatcherState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    guard.paused.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn resume_watchers(
    state: tauri::State<'_, std::sync::Mutex<FsWatcherState>>,
) -> Result<(), String> {
    let guard = state.lock().map_err(|e| e.to_string())?;
    guard.paused.store(false, Ordering::Relaxed);
    // Debounce tasks will pick up the next FS event naturally.
    // For immediate catch-up, the frontend fires a one-shot fallback poll on resume.
    Ok(())
}
