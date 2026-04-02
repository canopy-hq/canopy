use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::Emitter;
use portable_pty::{native_pty_system, PtySize, CommandBuilder, MasterPty, Child};

use crate::agent_watcher::{self, AgentDetectionEvent, AgentWatcherState, OutputAgentDetector, AgentStatus, AgentStatusPayload, now_millis};

pub struct PtyManager {
    pub(crate) writers: HashMap<u32, Box<dyn Write + Send>>,
    pub(crate) children: HashMap<u32, Box<dyn Child + Send>>,
    pub(crate) masters: HashMap<u32, Box<dyn MasterPty + Send>>,
    pub(crate) next_id: u32,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            writers: HashMap::new(),
            children: HashMap::new(),
            masters: HashMap::new(),
            next_id: 1,
        }
    }
}

#[tauri::command]
pub async fn spawn_terminal(
    on_output: Channel<Vec<u8>>,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<PtyManager>>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    // Spawn user's default shell
    let cmd = CommandBuilder::new_default_prog();
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    // Extract child PID immediately after spawn (Pitfall 7: may return None)
    let child_pid = child.process_id();

    // CRITICAL: Drop slave after spawn to prevent reader hang (Pitfall 1)
    drop(pair.slave);

    // Clone reader before taking writer -- master remains available for resize
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // Create atomic timestamp for output tracking (D-05)
    let last_output = Arc::new(AtomicU64::new(now_millis()));
    let last_output_clone = last_output.clone();

    let pty_id = {
        let mut manager = state.lock().map_err(|e| e.to_string())?;
        let id = manager.next_id;
        manager.next_id += 1;
        manager.writers.insert(id, writer);
        manager.children.insert(id, child);
        manager.masters.insert(id, pair.master);
        id
    };

    // Create output-based agent detector for this PTY
    let detector = Arc::new(Mutex::new(OutputAgentDetector::new()));
    let detector_clone = detector.clone();
    let app_clone = app.clone();

    // Store last_output Arc and detector in watcher state
    {
        let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
        ws.last_outputs.insert(pty_id, last_output.clone());
        ws.detectors.insert(pty_id, detector);
    }

    // Spawn reader thread using std::thread (NOT tokio -- portable-pty reader is blocking I/O)
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    // Track last output timestamp (D-05: zero-cost, bytes already flow)
                    last_output_clone.store(now_millis(), Ordering::Relaxed);

                    // Output-based agent detection (primary method)
                    if let Ok(mut det) = detector_clone.lock() {
                        if let Some(event) = det.feed(&buf[..n]) {
                            match event {
                                AgentDetectionEvent::Started { ref agent_name } => {
                                    let _ = app_clone.emit(
                                        "agent-status-changed",
                                        AgentStatusPayload {
                                            pty_id,
                                            status: AgentStatus::Running.as_str().to_string(),
                                            agent_name: agent_name.clone(),
                                            pid: 0, // no real PID from output matching
                                        },
                                    );
                                }
                                AgentDetectionEvent::Stopped { ref agent_name } => {
                                    let _ = app_clone.emit(
                                        "agent-status-changed",
                                        AgentStatusPayload {
                                            pty_id,
                                            status: AgentStatus::Idle.as_str().to_string(),
                                            agent_name: agent_name.clone(),
                                            pid: 0,
                                        },
                                    );
                                }
                                AgentDetectionEvent::Waiting { ref agent_name } => {
                                    let _ = app_clone.emit(
                                        "agent-status-changed",
                                        AgentStatusPayload {
                                            pty_id,
                                            status: AgentStatus::Waiting.as_str().to_string(),
                                            agent_name: agent_name.clone(),
                                            pid: 0,
                                        },
                                    );
                                }
                            }
                        }
                    }

                    if on_output.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Start agent watcher if we have a child PID
    if let Some(pid) = child_pid {
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        {
            let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
            ws.cancel_senders.insert(pty_id, cancel_tx);
        }
        // Get the detector Arc for this PTY (already created above)
        let det = {
            let ws = watcher_state.lock().map_err(|e| e.to_string())?;
            ws.detectors.get(&pty_id).cloned()
                .ok_or_else(|| format!("No detector for PTY {}", pty_id))?
        };
        agent_watcher::start_watching(pid, pty_id, app, det, cancel_rx);
    }

    Ok(pty_id)
}

#[tauri::command]
pub fn write_to_pty(
    pty_id: u32,
    data: Vec<u8>,
    state: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    let writer = manager
        .writers
        .get_mut(&pty_id)
        .ok_or_else(|| format!("PTY {} not found", pty_id))?;
    writer.write_all(&data).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn resize_pty(
    pty_id: u32,
    rows: u16,
    cols: u16,
    state: tauri::State<'_, Mutex<PtyManager>>,
) -> Result<(), String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    let master = manager
        .masters
        .get(&pty_id)
        .ok_or_else(|| format!("PTY {} not found", pty_id))?;
    master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn close_pty(
    pty_id: u32,
    state: tauri::State<'_, Mutex<PtyManager>>,
    watcher_state: tauri::State<'_, Mutex<AgentWatcherState>>,
) -> Result<(), String> {
    // Stop agent watcher first
    {
        let mut ws = watcher_state.lock().map_err(|e| e.to_string())?;
        if let Some(cancel) = ws.cancel_senders.remove(&pty_id) {
            let _ = cancel.send(());
        }
        ws.last_outputs.remove(&pty_id);
        ws.detectors.remove(&pty_id);
    }

    let mut manager = state.lock().map_err(|e| e.to_string())?;
    // Kill child process first
    if let Some(mut child) = manager.children.remove(&pty_id) {
        let _ = child.kill();
        let _ = child.wait();
    }
    // Drop writer (closes write end of PTY)
    manager.writers.remove(&pty_id);
    // Drop master (closes PTY file descriptors, reader thread will exit)
    manager.masters.remove(&pty_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pty_manager_new() {
        let manager = PtyManager::new();
        assert_eq!(manager.next_id, 1);
    }

    #[test]
    fn test_close_pty_nonexistent_is_ok() {
        let manager = PtyManager::new();
        // Calling close on non-existent ID should not panic
        assert!(manager.children.get(&999).is_none());
        assert!(manager.writers.get(&999).is_none());
        assert!(manager.masters.get(&999).is_none());
    }

    #[test]
    fn test_pty_manager_starts_empty() {
        let manager = PtyManager::new();
        assert!(manager.writers.is_empty());
        assert!(manager.children.is_empty());
        assert!(manager.masters.is_empty());
    }
}
