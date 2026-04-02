use std::os::unix::net::UnixStream as StdUnixStream;
use std::path::{Path, PathBuf};
use std::sync::{Arc, atomic::AtomicU64};
use std::sync::atomic::Ordering;

use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;

use crate::agent_watcher::now_millis;

pub struct DaemonClient {
    pub socket: PathBuf,
    // Persistent stream for fire-and-forget ops (write, resize)
    cmd_stream: Arc<Mutex<Option<UnixStream>>>,
}

impl DaemonClient {
    pub fn new(socket: PathBuf) -> Self {
        Self {
            socket,
            cmd_stream: Arc::new(Mutex::new(None)),
        }
    }

    /// Ensure daemon process is running. Synchronous — safe to call from Tauri setup.
    pub fn ensure_daemon_sync(socket: &Path, bin: &Path) -> Result<(), String> {
        // Try to connect first (daemon may already be running)
        if StdUnixStream::connect(socket).is_ok() {
            return Ok(());
        }

        // Spawn daemon in its own process group so it survives app exit
        use std::os::unix::process::CommandExt;
        std::process::Command::new(bin)
            .arg(socket)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .process_group(0)
            .spawn()
            .map_err(|e| format!("spawn daemon: {e}"))?;

        // Retry up to 5×50ms = 250ms total
        for _ in 0..5 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if StdUnixStream::connect(socket).is_ok() {
                return Ok(());
            }
        }

        Err("daemon did not start within timeout".to_string())
    }

    /// Send a command that expects a JSON response (per-call connection).
    async fn send_cmd(&self, msg: &str) -> Result<serde_json::Value, String> {
        let mut stream = UnixStream::connect(&self.socket)
            .await
            .map_err(|e| format!("connect: {e}"))?;
        stream.write_all(msg.as_bytes()).await.map_err(|e| e.to_string())?;

        let mut reader = BufReader::new(&mut stream);
        let mut line = String::new();
        reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        serde_json::from_str(line.trim()).map_err(|e| e.to_string())
    }

    /// Send a fire-and-forget command on the persistent command stream.
    async fn send_noack(&self, msg: &str) -> Result<(), String> {
        let mut guard = self.cmd_stream.lock().await;

        // Try existing stream
        if let Some(stream) = guard.as_mut() {
            if stream.write_all(msg.as_bytes()).await.is_ok() {
                return Ok(());
            }
        }

        // Reconnect and retry
        let mut stream = UnixStream::connect(&self.socket)
            .await
            .map_err(|e| format!("reconnect: {e}"))?;
        stream.write_all(msg.as_bytes()).await.map_err(|e| e.to_string())?;
        *guard = Some(stream);
        Ok(())
    }

    /// Spawn a PTY session for pane_id (no-op if already exists).
    /// Returns the child process PID used as ptyId on the Tauri side.
    pub async fn spawn(&self, pane_id: &str, cwd: Option<&str>) -> Result<u32, String> {
        let msg = if let Some(cwd) = cwd {
            format!(
                "{{\"op\":\"spawn\",\"paneId\":{},\"cwd\":{}}}\n",
                serde_json::json!(pane_id),
                serde_json::json!(cwd),
            )
        } else {
            format!("{{\"op\":\"spawn\",\"paneId\":{}}}\n", serde_json::json!(pane_id))
        };

        let resp = self.send_cmd(&msg).await?;
        if resp["ok"].as_bool() == Some(true) {
            resp["pid"]
                .as_u64()
                .map(|p| p as u32)
                .ok_or_else(|| "daemon: spawn returned no pid".to_string())
        } else {
            Err(resp["error"].as_str().unwrap_or("spawn failed").to_string())
        }
    }

    /// Write data to a PTY session (fire-and-forget, persistent stream).
    pub async fn write(&self, pane_id: &str, data: &[u8]) -> Result<(), String> {
        let arr: Vec<u8> = data.to_vec();
        let msg = format!(
            "{{\"op\":\"write\",\"paneId\":{},\"data\":{}}}\n",
            serde_json::json!(pane_id),
            serde_json::json!(arr),
        );
        self.send_noack(&msg).await
    }

    /// Resize a PTY session (fire-and-forget, persistent stream).
    pub async fn resize(&self, pane_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let msg = format!(
            "{{\"op\":\"resize\",\"paneId\":{},\"rows\":{},\"cols\":{}}}\n",
            serde_json::json!(pane_id),
            rows,
            cols,
        );
        self.send_noack(&msg).await
    }

    /// Close a PTY session and kill its process.
    pub async fn close(&self, pane_id: &str) -> Result<(), String> {
        let msg = format!("{{\"op\":\"close\",\"paneId\":{}}}\n", serde_json::json!(pane_id));
        let resp = self.send_cmd(&msg).await?;
        if resp["ok"].as_bool() == Some(true) {
            Ok(())
        } else {
            Err("close failed".to_string())
        }
    }

    /// List all active pane IDs in the daemon.
    pub async fn list(&self) -> Result<Vec<String>, String> {
        let resp = self.send_cmd("{\"op\":\"list\"}\n").await?;
        resp["paneIds"]
            .as_array()
            .ok_or_else(|| "no paneIds".to_string())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            })
    }

    /// Attach to a PTY session: spawns a background task that reads frames
    /// from the daemon and sends them to `on_output`. Updates `last_output` timestamp
    /// on each chunk (used by the agent watcher for silence detection).
    pub fn attach(
        &self,
        pane_id: String,
        on_output: Channel<Vec<u8>>,
        last_output: Arc<AtomicU64>,
    ) {
        let socket = self.socket.clone();

        tokio::spawn(async move {
            let msg = format!(
                "{{\"op\":\"attach\",\"paneId\":{}}}\n",
                serde_json::json!(&pane_id)
            );

            let mut stream = match UnixStream::connect(&socket).await {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("attach: connect failed: {e}");
                    return;
                }
            };

            if stream.write_all(msg.as_bytes()).await.is_err() {
                return;
            }

            // Read binary frames: [4-byte big-endian length][bytes]
            let mut len_buf = [0u8; 4];
            loop {
                if stream.read_exact(&mut len_buf).await.is_err() {
                    break;
                }
                let len = u32::from_be_bytes(len_buf) as usize;
                if len == 0 {
                    continue;
                }

                let mut data = vec![0u8; len];
                if stream.read_exact(&mut data).await.is_err() {
                    break;
                }

                last_output.store(now_millis(), Ordering::Relaxed);
                if on_output.send(data).is_err() {
                    break;
                }
            }
        });
    }
}
