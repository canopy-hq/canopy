use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::broadcast;

const SCROLLBACK_CAP: usize = 100 * 1024; // 100KB per session

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    child_pid: u32,
    scrollback: Vec<u8>,
    tx: broadcast::Sender<Vec<u8>>,
}

pub struct DaemonState {
    sessions: HashMap<String, PtySession>,
}

impl DaemonState {
    pub fn new() -> Self {
        Self { sessions: HashMap::new() }
    }
}

pub async fn run(socket_path: String) {
    let _ = std::fs::remove_file(&socket_path);
    let listener = UnixListener::bind(&socket_path).expect("daemon: bind failed");
    let state = Arc::new(Mutex::new(DaemonState::new()));

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                tokio::spawn(handle_connection(stream, state.clone()));
            }
            Err(e) => eprintln!("daemon accept: {e}"),
        }
    }
}

async fn handle_connection(stream: UnixStream, state: Arc<Mutex<DaemonState>>) {
    let (reader_half, mut write_half) = stream.into_split();
    let mut reader = BufReader::new(reader_half);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }

        let cmd: serde_json::Value = match serde_json::from_str(line.trim()) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let op = cmd["op"].as_str().unwrap_or("").to_string();
        let pane_id = cmd["paneId"].as_str().unwrap_or("").to_string();

        match op.as_str() {
            "spawn" => {
                let cwd = cmd["cwd"].as_str().map(|s| s.to_string());
                let rows = cmd["rows"].as_u64().unwrap_or(24) as u16;
                let cols = cmd["cols"].as_u64().unwrap_or(80) as u16;
                let result = do_spawn(state.clone(), pane_id, cwd, rows, cols);
                let resp = match result {
                    Ok(pid) => format!("{{\"ok\":true,\"pid\":{pid}}}\n"),
                    Err(e) => format!("{{\"ok\":false,\"error\":{}}}\n", serde_json::json!(e)),
                };
                let _ = write_half.write_all(resp.as_bytes()).await;
            }

            "attach" => {
                let result = {
                    let st = state.lock().unwrap();
                    st.sessions.get(&pane_id).map(|s| (s.scrollback.clone(), s.tx.subscribe()))
                };
                let (scrollback, mut rx) = match result {
                    Some(r) => r,
                    None => break,
                };

                // Send buffered scrollback as one frame
                if !scrollback.is_empty() {
                    let len = (scrollback.len() as u32).to_be_bytes();
                    if write_half.write_all(&len).await.is_err() { return; }
                    if write_half.write_all(&scrollback).await.is_err() { return; }
                }

                // Sentinel: zero-length frame marking end of scrollback replay.
                // The TypeScript layer detects this as `rawData.length === 0` and
                // uses it to distinguish replayed history from live PTY output.
                if write_half.write_all(&[0u8; 4]).await.is_err() { return; }

                // Stream live output
                loop {
                    match rx.recv().await {
                        Ok(data) => {
                            let len = (data.len() as u32).to_be_bytes();
                            if write_half.write_all(&len).await.is_err() { return; }
                            if write_half.write_all(&data).await.is_err() { return; }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => return,
                    }
                }
            }

            "write" => {
                if let Some(arr) = cmd["data"].as_array() {
                    let bytes: Vec<u8> = arr.iter()
                        .filter_map(|v| v.as_u64())
                        .map(|n| n as u8)
                        .collect();
                    let mut st = state.lock().unwrap();
                    if let Some(sess) = st.sessions.get_mut(&pane_id) {
                        let _ = sess.writer.write_all(&bytes);
                        let _ = sess.writer.flush();
                    }
                }
            }

            "resize" => {
                let rows = cmd["rows"].as_u64().unwrap_or(24) as u16;
                let cols = cmd["cols"].as_u64().unwrap_or(80) as u16;
                let st = state.lock().unwrap();
                if let Some(sess) = st.sessions.get(&pane_id) {
                    let _ = sess.master.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    });
                }
            }

            "close" => {
                let removed = {
                    let mut st = state.lock().unwrap();
                    st.sessions.remove(&pane_id)
                };
                if let Some(mut sess) = removed {
                    let _ = sess.child.kill();
                    let _ = sess.child.wait();
                }
                let _ = write_half.write_all(b"{\"ok\":true}\n").await;
            }

            "list" => {
                let ids: Vec<String> = {
                    let st = state.lock().unwrap();
                    st.sessions.keys().cloned().collect()
                };
                let resp = format!("{{\"paneIds\":{}}}\n", serde_json::json!(ids));
                let _ = write_half.write_all(resp.as_bytes()).await;
            }

            _ => {}
        }
    }
}

fn do_spawn(
    state: Arc<Mutex<DaemonState>>,
    pane_id: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<u32, String> {
    // Return existing session pid if it already exists (reconnect case)
    {
        let st = state.lock().unwrap();
        if let Some(sess) = st.sessions.get(&pane_id) {
            return Ok(sess.child_pid);
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new_default_prog();
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(ref dir) = cwd {
        cmd.cwd(dir);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let child_pid = child.process_id().unwrap_or(0);
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // broadcast::channel capacity: 256 chunks before lagging
    let (tx, _) = broadcast::channel::<Vec<u8>>(256);

    {
        let mut st = state.lock().unwrap();
        st.sessions.insert(
            pane_id.clone(),
            PtySession {
                writer,
                master: pair.master,
                child,
                child_pid,
                scrollback: Vec::new(),
                tx,
            },
        );
    }

    // Reader thread: blocking I/O — tee to scrollback + broadcast.
    // Both operations happen under the same lock to eliminate the race where
    // an attach handler could clone the scrollback AND subscribe to the
    // broadcast between the lock-drop and the send, receiving the same chunk twice.
    let state_clone = state.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let mut st = state_clone.lock().unwrap();
                    if let Some(sess) = st.sessions.get_mut(&pane_id) {
                        let total = sess.scrollback.len() + data.len();
                        if total > SCROLLBACK_CAP {
                            sess.scrollback.drain(0..total - SCROLLBACK_CAP);
                        }
                        sess.scrollback.extend_from_slice(&data);
                        let _ = sess.tx.send(data);
                    }
                }
            }
        }
    });

    Ok(child_pid)
}
