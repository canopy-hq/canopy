// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  ⚠️  CAUTION — LOW-LEVEL DAEMON PROTOCOL & BINARY FRAMING  ⚠️              ║
// ║                                                                            ║
// ║  This module owns the Unix socket protocol between the Tauri app and the   ║
// ║  standalone PTY daemon. It handles binary-framed output (4-byte BE length  ║
// ║  prefix), persistent streams for fire-and-forget ops, and the sentinel     ║
// ║  frame (zero-length) that signals scrollback replay completion.            ║
// ║                                                                            ║
// ║  Before modifying:                                                         ║
// ║    1. Read the daemon protocol spec in packages/pty-daemon/CLAUDE.md       ║
// ║    2. Understand the two connection modes: per-call (spawn/claim/close)    ║
// ║       vs persistent stream (write/resize)                                  ║
// ║    3. The attach() task runs for the LIFETIME of a terminal — breaking     ║
// ║       its read loop kills all output for that pane                         ║
// ║    4. Test with: rapid typing, resize during scrollback replay, reconnect  ║
// ║                                                                            ║
// ║  Key invariants:                                                           ║
// ║    - Sentinel (zero-length frame) must be forwarded to TypeScript          ║
// ║    - ready_tx fires exactly once per attach (on sentinel)                  ║
// ║    - Persistent cmd_stream auto-reconnects on broken pipe                  ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

use std::os::unix::net::UnixStream as StdUnixStream;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::sync::Mutex;

#[derive(Debug)]
pub struct ClaimResult {
    pub pid: u32,
    pub empty: bool,
}

pub struct DaemonClient {
    pub socket: PathBuf,
    bin: PathBuf,
    // Persistent stream for fire-and-forget ops (write, resize).
    // Does not auto-restart on daemon death — send_cmd handles restart,
    // and send_noack reconnects on its own next call.
    cmd_stream: Arc<Mutex<Option<UnixStream>>>,
    // Guards daemon restart so concurrent send_cmd failures don't each spawn a new daemon.
    restart_lock: Arc<Mutex<()>>,
}

impl DaemonClient {
    pub fn new(socket: PathBuf, bin: PathBuf) -> Self {
        Self {
            socket,
            bin,
            cmd_stream: Arc::new(Mutex::new(None)),
            restart_lock: Arc::new(Mutex::new(())),
        }
    }

    /// Expected daemon protocol version. Must match `PROTOCOL_VERSION` in daemon.rs.
    const EXPECTED_PROTOCOL_VERSION: u32 = 3;

    /// Ensure daemon process is running with the correct protocol version.
    /// Synchronous — safe to call from Tauri setup.
    /// Returns `Some(pid)` when a new daemon was spawned, `None` when one was already running.
    pub fn ensure_daemon_sync(socket: &Path, bin: &Path) -> Result<Option<u32>, String> {
        // Try to connect first (daemon may already be running)
        if let Ok(mut stream) = StdUnixStream::connect(socket) {
            // Check protocol version — stale daemon (from a previous build) might
            // not support new ops/fields. Kill and restart if mismatched.
            use std::io::{BufRead, BufReader, Write as _};
            let _ = stream.write_all(b"{\"op\":\"version\",\"paneId\":\"\"}\n");
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
            let mut line = String::new();
            let version_ok = BufReader::new(&stream)
                .read_line(&mut line)
                .ok()
                .and_then(|_| serde_json::from_str::<serde_json::Value>(line.trim()).ok())
                .and_then(|v| v["version"].as_u64())
                .map(|v| v as u32)
                == Some(Self::EXPECTED_PROTOCOL_VERSION);

            if version_ok {
                return Ok(None);
            }

            // Stale daemon — kill it so we can spawn a fresh one.
            eprintln!("[daemon] protocol version mismatch (got {line:?}), restarting");
            drop(stream);
            let _ = std::fs::remove_file(socket);
            // Give the old daemon time to exit after socket removal.
            std::thread::sleep(std::time::Duration::from_millis(100));
        }

        // Spawn daemon in its own process group so it survives app restart
        use std::os::unix::process::CommandExt;
        eprintln!("[daemon] spawning bin={} socket={}", bin.display(), socket.display());
        let child = std::process::Command::new(bin)
            .arg(socket)
            .arg(std::process::id().to_string())
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::inherit())
            .process_group(0)
            .spawn()
            .map_err(|e| format!("spawn daemon: {e}"))?;
        let pid = child.id();
        // Leak the Child so it isn't waited on — the daemon runs independently.
        std::mem::forget(child);

        // Retry up to 5×50ms = 250ms total
        for _ in 0..5 {
            std::thread::sleep(std::time::Duration::from_millis(50));
            if StdUnixStream::connect(socket).is_ok() {
                return Ok(Some(pid));
            }
        }

        // Daemon started but never accepted connections — kill the stray process.
        let _ = std::process::Command::new("kill").args(["-TERM", &pid.to_string()]).output();
        Err("daemon did not start within timeout".to_string())
    }

    /// Check that a daemon response has `ok: true`, otherwise extract the error.
    fn check_ok(resp: serde_json::Value, fallback: &str) -> Result<serde_json::Value, String> {
        if resp["ok"].as_bool() == Some(true) {
            Ok(resp)
        } else {
            Err(resp["error"].as_str().unwrap_or(fallback).to_string())
        }
    }

    /// Send a command that expects a JSON response (per-call connection).
    /// On ConnectionRefused, serializes a one-shot daemon restart behind restart_lock
    /// (so concurrent failures don't race to spawn multiple daemons), then retries.
    async fn send_cmd(&self, msg: &str) -> Result<serde_json::Value, String> {
        let mut stream = match UnixStream::connect(&self.socket).await {
            Ok(s) => s,
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::NotFound
                ) =>
            {
                let _guard = self.restart_lock.lock().await;
                // A concurrent caller may have already restarted the daemon — try connecting first.
                match UnixStream::connect(&self.socket).await {
                    Ok(s) => s,
                    Err(_) => {
                        eprintln!("[daemon] connection refused — restarting daemon");
                        // Clear stale cmd_stream before restart so send_noack reconnects
                        // even if the restart itself fails.
                        *self.cmd_stream.lock().await = None;
                        let socket = self.socket.clone();
                        let bin = self.bin.clone();
                        tokio::task::spawn_blocking(move || Self::ensure_daemon_sync(&socket, &bin))
                            .await
                            .map_err(|e| e.to_string())??;
                        UnixStream::connect(&self.socket)
                            .await
                            .map_err(|e| format!("connect after restart: {e}"))?
                    }
                }
            }
            Err(e) => return Err(format!("connect: {e}")),
        };
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
    /// Returns `(pid, is_new)` — `is_new` is false when the session already existed.
    pub async fn spawn(
        &self,
        pane_id: &str,
        cwd: Option<&str>,
        rows: u16,
        cols: u16,
        env_vars: Option<&std::collections::HashMap<String, String>>,
    ) -> Result<(u32, bool), String> {
        let mut obj = serde_json::json!({
            "op": "spawn",
            "paneId": pane_id,
            "rows": rows,
            "cols": cols,
        });
        if let Some(cwd) = cwd {
            obj["cwd"] = serde_json::json!(cwd);
        }
        if let Some(vars) = env_vars {
            obj["envVars"] = serde_json::json!(vars);
        }
        let msg = format!("{obj}\n");

        let resp = Self::check_ok(self.send_cmd(&msg).await?, "spawn failed")?;
        let pid = resp["pid"]
            .as_u64()
            .map(|p| p as u32)
            .ok_or_else(|| "daemon: spawn returned no pid".to_string())?;
        let is_new = resp["new"].as_bool().unwrap_or(true);
        Ok((pid, is_new))
    }

    /// Write data to a PTY session (fire-and-forget, persistent stream).
    pub async fn write(&self, pane_id: &str, data: &[u8]) -> Result<(), String> {
        let msg = format!(
            "{{\"op\":\"write\",\"paneId\":{},\"data\":{}}}\n",
            serde_json::json!(pane_id),
            serde_json::json!(data),
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

    /// Get the current working directory of a PTY session's shell process.
    pub async fn get_cwd(&self, pane_id: &str) -> Result<String, String> {
        let msg = format!("{{\"op\":\"cwd\",\"paneId\":{}}}\n", serde_json::json!(pane_id));
        let resp = Self::check_ok(self.send_cmd(&msg).await?, "cwd failed")?;
        resp["cwd"].as_str().map(String::from).ok_or_else(|| "no cwd in response".to_string())
    }

    /// Close a PTY session and kill its process.
    pub async fn close(&self, pane_id: &str) -> Result<(), String> {
        let msg = format!("{{\"op\":\"close\",\"paneId\":{}}}\n", serde_json::json!(pane_id));
        Self::check_ok(self.send_cmd(&msg).await?, "close failed")?;
        Ok(())
    }

    /// Claim a pre-warmed PTY from the daemon pool.
    /// Returns `ClaimResult { pid, empty }`. When `empty` is true (pool empty or
    /// cwd mismatch), the caller should fall back to a regular `spawn`.
    pub async fn claim(
        &self,
        pane_id: &str,
        cwd: Option<&str>,
        rows: u16,
        cols: u16,
        env_vars: Option<&std::collections::HashMap<String, String>>,
    ) -> Result<ClaimResult, String> {
        let mut obj = serde_json::json!({
            "op": "claim",
            "paneId": pane_id,
            "rows": rows,
            "cols": cols,
        });
        if let Some(cwd) = cwd {
            obj["cwd"] = serde_json::json!(cwd);
        }
        if let Some(vars) = env_vars {
            obj["envVars"] = serde_json::json!(vars);
        }
        let msg = format!("{obj}\n");
        let resp = Self::check_ok(self.send_cmd(&msg).await?, "claim failed")?;
        Ok(ClaimResult {
            pid: resp["pid"].as_u64().unwrap_or(0) as u32,
            empty: resp["empty"].as_bool().unwrap_or(false),
        })
    }

    /// Initialize the daemon's PTY pool for the given CWD.
    pub async fn init_pool(&self, cwd: &str, size: usize) -> Result<(), String> {
        let msg = format!(
            "{{\"op\":\"init_pool\",\"cwd\":{},\"size\":{}}}\n",
            serde_json::json!(cwd),
            size,
        );
        Self::check_ok(self.send_cmd(&msg).await?, "init_pool failed")?;
        Ok(())
    }

    /// Drain and kill all pool entries.
    #[allow(dead_code)]
    pub async fn drain_pool(&self) -> Result<(), String> {
        let msg = "{\"op\":\"drain_pool\",\"paneId\":\"\"}\n";
        Self::check_ok(self.send_cmd(msg).await?, "drain_pool failed")?;
        Ok(())
    }

    /// Attach to a PTY session: spawns a background task that reads frames
    /// from the daemon and sends them to `on_output`.
    ///
    /// `ready_tx` is fired once when the daemon sentinel (zero-length frame marking
    /// end of scrollback replay) is forwarded. `spawn_terminal` awaits this signal
    /// before returning to TypeScript, guaranteeing the ChannelEntry has the full
    /// scrollback buffered when the Tauri invoke resolves.
    ///
    /// Returns the JoinHandle so callers can abort a superseded attach task.
    pub fn attach(
        &self,
        pane_id: String,
        on_output: Channel<Vec<u8>>,
        ready_tx: tokio::sync::oneshot::Sender<()>,
    ) -> tokio::task::JoinHandle<()> {
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
            let mut ready_tx = Some(ready_tx);
            loop {
                if stream.read_exact(&mut len_buf).await.is_err() {
                    break;
                }
                let len = u32::from_be_bytes(len_buf) as usize;
                let mut data = vec![0u8; len];
                if len > 0 {
                    if stream.read_exact(&mut data).await.is_err() {
                        break;
                    }
                } else {
                    // Sentinel: scrollback replay complete. Signal spawn_terminal so it
                    // can return to TypeScript with a fully-buffered ChannelEntry.
                    if let Some(tx) = ready_tx.take() {
                        let _ = tx.send(());
                    }
                }
                // Forward the frame — including the empty sentinel — to TypeScript.
                // An empty Vec<u8> arrives as `rawData.length === 0` in channel.onmessage.
                if on_output.send(data).is_err() {
                    break;
                }
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixListener;

    // ---- check_ok ----

    #[test]
    fn check_ok_returns_value_on_success() {
        let val = serde_json::json!({ "ok": true, "pid": 42 });
        assert_eq!(DaemonClient::check_ok(val.clone(), "fallback").unwrap(), val);
    }

    #[test]
    fn check_ok_returns_fallback_when_no_error_field() {
        let val = serde_json::json!({ "ok": false });
        assert_eq!(
            DaemonClient::check_ok(val, "fallback msg").unwrap_err(),
            "fallback msg"
        );
    }

    #[test]
    fn check_ok_returns_error_field_when_present() {
        let val = serde_json::json!({ "ok": false, "error": "pane not found" });
        assert_eq!(
            DaemonClient::check_ok(val, "fallback").unwrap_err(),
            "pane not found"
        );
    }

    #[test]
    fn check_ok_treats_missing_ok_as_failure() {
        let val = serde_json::json!({ "pid": 1 });
        assert!(DaemonClient::check_ok(val, "no ok field").is_err());
    }

    // ---- send_cmd round-trip ----

    #[tokio::test]
    async fn send_cmd_writes_message_and_parses_json_response() {
        let dir = tempfile::tempdir().unwrap();
        let socket_path = dir.path().join("test.sock");

        let listener = UnixListener::bind(&socket_path).unwrap();
        let server = tokio::spawn(async move {
            let (mut conn, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 256];
            let n = conn.read(&mut buf).await.unwrap();
            let received = String::from_utf8_lossy(&buf[..n]).to_string();
            conn.write_all(b"{\"ok\":true,\"pid\":99}\n").await.unwrap();
            received
        });

        let client = DaemonClient::new(socket_path, PathBuf::from("/nonexistent"));
        let result = client.send_cmd("{\"op\":\"ping\"}\n").await.unwrap();

        let sent = server.await.unwrap();
        assert!(sent.contains("\"op\":\"ping\""));
        assert_eq!(result["ok"].as_bool(), Some(true));
        assert_eq!(result["pid"].as_u64(), Some(99));
    }

    #[tokio::test]
    async fn send_cmd_returns_error_when_socket_missing() {
        let dir = tempfile::tempdir().unwrap();
        let socket_path = dir.path().join("nonexistent.sock");
        // No listener — socket file does not exist → NotFound
        let client = DaemonClient::new(socket_path, PathBuf::from("/nonexistent"));
        // NotFound triggers the restart path, which also fails (bin doesn't exist).
        // The important thing is that we get an Err, not a panic.
        assert!(client.send_cmd("{\"op\":\"ping\"}\n").await.is_err());
    }
}
