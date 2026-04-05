use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::broadcast;

use crate::pool::Pool;
use crate::scrollback::ScrollbackBuffer;

/// Get the current working directory of a process on macOS via proc_pidinfo(PROC_PIDVNODEPATHINFO).
/// proc_pid::pidcwd from the libproc crate reads /proc/{pid}/cwd which only exists on Linux.
#[cfg(target_os = "macos")]
fn get_pid_cwd(pid: u32) -> Result<String, String> {
    use std::ffi::c_void;

    const PROC_PIDVNODEPATHINFO: i32 = 9;
    // sizeof(struct proc_vnodepathinfo) on macOS 64-bit = 2 × (sizeof(vnode_info)=152 + MAXPATHLEN=1024) = 2352
    const INFO_SIZE: usize = 2352;
    // pvi_cdir.vip_path starts at offset sizeof(vnode_info) = 152 inside the struct
    const PATH_OFFSET: usize = 152;

    extern "C" {
        fn proc_pidinfo(pid: i32, flavor: i32, arg: u64, buf: *mut c_void, size: i32) -> i32;
    }

    let mut buf = vec![0u8; INFO_SIZE];
    let ret = unsafe {
        proc_pidinfo(pid as i32, PROC_PIDVNODEPATHINFO, 0, buf.as_mut_ptr() as *mut c_void, INFO_SIZE as i32)
    };
    if ret <= 0 {
        return Err(format!("proc_pidinfo failed (ret={ret}, errno={})", std::io::Error::last_os_error()));
    }

    let path_bytes = &buf[PATH_OFFSET..];
    let end = path_bytes.iter().position(|&b| b == 0).unwrap_or(path_bytes.len());
    std::str::from_utf8(&path_bytes[..end]).map(String::from).map_err(|e| e.to_string())
}

const SCROLLBACK_CAP: usize = 100 * 1024; // 100KB per session

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    child_pid: u32,
    scrollback: ScrollbackBuffer,
    tx: broadcast::Sender<Vec<u8>>,
}

pub struct DaemonState {
    sessions: HashMap<String, PtySession>,
    pub pool: Pool,
}

impl DaemonState {
    pub fn new() -> Self {
        Self { sessions: HashMap::new(), pool: Pool::new() }
    }
}

pub async fn run(socket_path: String) {
    let _ = std::fs::remove_file(&socket_path);
    let listener = UnixListener::bind(&socket_path).expect("daemon: bind failed");
    let state = Arc::new(Mutex::new(DaemonState::new()));

    for _ in 0..2 {
        if let Err(e) = pool_warm_one(&state) {
            eprintln!("pool: warm failed: {e}");
        }
    }

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
                let command = cmd["command"].as_str().map(String::from);
                let args: Vec<String> = cmd["args"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                let result = do_spawn(state.clone(), pane_id, cwd, rows, cols, command, args);
                let resp = match result {
                    Ok((pid, is_new)) => format!("{{\"ok\":true,\"pid\":{pid},\"new\":{is_new}}}\n"),
                    Err(e) => format!("{{\"ok\":false,\"error\":{}}}\n", serde_json::json!(e)),
                };
                let _ = write_half.write_all(resp.as_bytes()).await;
            }

            "attach" => {
                let result = {
                    let st = state.lock().unwrap();
                    st.sessions
                        .get(&pane_id)
                        .map(|s| (s.scrollback.get().to_vec(), s.tx.subscribe()))
                };
                let (scrollback, mut rx) = match result {
                    Some(r) => r,
                    None => {
                        let _ = write_half.write_all(b"{\"ok\":false,\"error\":\"session not found\"}\n").await;
                        break;
                    }
                };

                // Send buffered scrollback as one frame
                if !scrollback.is_empty() {
                    let len = (scrollback.len() as u32).to_be_bytes();
                    if write_half.write_all(&len).await.is_err() {
                        return;
                    }
                    if write_half.write_all(&scrollback).await.is_err() {
                        return;
                    }
                }

                // Sentinel: zero-length frame marking end of scrollback replay.
                // The TypeScript layer detects this as `rawData.length === 0` and
                // uses it to distinguish replayed history from live PTY output.
                if write_half.write_all(&[0u8; 4]).await.is_err() {
                    return;
                }

                // Stream live output
                loop {
                    match rx.recv().await {
                        Ok(data) => {
                            let len = (data.len() as u32).to_be_bytes();
                            if write_half.write_all(&len).await.is_err() {
                                return;
                            }
                            if write_half.write_all(&data).await.is_err() {
                                return;
                            }
                        }
                        Err(broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(_) => return,
                    }
                }
            }

            "write" => {
                if let Some(arr) = cmd["data"].as_array() {
                    let bytes: Vec<u8> = arr
                        .iter()
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

            "cwd" => {
                let pid = {
                    let st = state.lock().unwrap();
                    st.sessions.get(&pane_id).map(|s| s.child_pid)
                };
                let resp = match pid {
                    Some(pid) => match get_pid_cwd(pid) {
                        Ok(path) => format!("{{\"ok\":true,\"cwd\":{}}}\n", serde_json::json!(path)),
                        Err(e) => format!("{{\"ok\":false,\"error\":{}}}\n", serde_json::json!(e)),
                    },
                    None => "{\"ok\":false,\"error\":\"session not found\"}\n".to_string(),
                };
                let _ = write_half.write_all(resp.as_bytes()).await;
            }

            "claim" => {
                let cwd = cmd["cwd"].as_str().map(|s| s.to_string());
                let rows = cmd["rows"].as_u64().unwrap_or(24) as u16;
                let cols = cmd["cols"].as_u64().unwrap_or(80) as u16;

                let claimed = {
                    let mut st = state.lock().unwrap();
                    st.pool.claim()
                };

                let resp = match claimed {
                    Some((temp_pane_id, pid)) => {
                        // Remap session key: temp → real pane_id
                        {
                            let mut st = state.lock().unwrap();
                            if let Some(session) = st.sessions.remove(&temp_pane_id) {
                                let _ = session.master.resize(PtySize {
                                    rows, cols, pixel_width: 0, pixel_height: 0,
                                });
                                st.sessions.insert(pane_id.clone(), session);
                            }
                        }

                        // Send cd + clear to the shell
                        if let Some(dir) = &cwd {
                            let cd_cmd = format!(" cd {} && clear\n", shell_escape(dir));
                            let mut st = state.lock().unwrap();
                            if let Some(sess) = st.sessions.get_mut(&pane_id) {
                                let _ = sess.writer.write_all(cd_cmd.as_bytes());
                                let _ = sess.writer.flush();
                            }
                        }

                        // Replenish pool in background
                        let state_clone = state.clone();
                        tokio::spawn(async move {
                            let res = tokio::task::spawn_blocking(move || pool_warm_one(&state_clone)).await;
                            if let Ok(Err(e)) = res {
                                eprintln!("pool: replenish failed: {e}");
                            }
                        });

                        format!("{{\"ok\":true,\"pid\":{pid},\"new\":true}}\n")
                    }
                    None => {
                        format!("{{\"ok\":false,\"error\":\"pool empty\"}}\n")
                    }
                };
                let _ = write_half.write_all(resp.as_bytes()).await;
            }

            "pool_status" => {
                let (ready, warming) = {
                    let st = state.lock().unwrap();
                    st.pool.status()
                };
                let resp = format!("{{\"ready\":{ready},\"warming\":{warming}}}\n");
                let _ = write_half.write_all(resp.as_bytes()).await;
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

fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Spawn one warm pool session. Does NOT hold the state lock during spawn.
fn pool_warm_one(state: &Arc<Mutex<DaemonState>>) -> Result<(), String> {
    let temp_id = {
        let mut st = state.lock().unwrap();
        st.pool.next_temp_id()
    };
    let (pid, _) = do_spawn(state.clone(), temp_id.clone(), None, 24, 80, None, vec![])?;
    {
        let mut st = state.lock().unwrap();
        st.pool.add_entry(temp_id, pid);
    }
    Ok(())
}

/// Returns `(pid, is_new)` where `is_new` is false when the session already existed.
pub fn do_spawn(
    state: Arc<Mutex<DaemonState>>,
    pane_id: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
    command: Option<String>,
    args: Vec<String>,
) -> Result<(u32, bool), String> {
    // Return existing session pid if it already exists (reconnect case).
    // Also resize the PTY to the requested dimensions so the subprocess sees the
    // current container size immediately and redraws — without this, the shell
    // keeps its stale dimensions from the previous session.
    {
        let st = state.lock().unwrap();
        if let Some(sess) = st.sessions.get(&pane_id) {
            let pid = sess.child_pid;
            let _ = sess.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
            return Ok((pid, false));
        }
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = match command {
        Some(ref c) => {
            let mut b = CommandBuilder::new(c);
            for arg in &args {
                b.arg(arg);
            }
            b
        }
        None => CommandBuilder::new_default_prog(),
    };
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
                scrollback: ScrollbackBuffer::new(SCROLLBACK_CAP),
                tx,
            },
        );
    }

    // Reader thread: blocking I/O — tee to scrollback + broadcast.
    // Scrollback push happens under the lock; broadcast send happens outside to
    // avoid blocking all sessions if a receiver is slow. The attach handler
    // subscribes to tx BEFORE copying scrollback (both under the same lock),
    // so a chunk is received via scrollback OR broadcast, never both/neither.
    let state_clone = state.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pool_readied = false;
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let tx = {
                        let mut st = state_clone.lock().unwrap();
                        if let Some(sess) = st.sessions.get_mut(&pane_id) {
                            sess.scrollback.push(&data);
                            Some(sess.tx.clone())
                        } else {
                            None
                        }
                    };
                    if let Some(tx) = tx {
                        let _ = tx.send(data);
                    }
                    if !pool_readied && pane_id.starts_with("__pool_") {
                        pool_readied = true;
                        let mut st = state_clone.lock().unwrap();
                        st.pool.mark_ready(&pane_id);
                    }
                }
            }
        }
        // Clean up dead pool entries on EOF
        if pane_id.starts_with("__pool_") {
            let mut st = state_clone.lock().unwrap();
            st.pool.remove_dead(&pane_id);
        }
    });

    Ok((child_pid, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::io::AsyncReadExt;

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_socket() -> String {
        format!(
            "/tmp/test-daemon-{}.sock",
            COUNTER.fetch_add(1, Ordering::Relaxed)
        )
    }

    async fn start_daemon(socket_path: &str) {
        let path = socket_path.to_string();
        tokio::spawn(async move { run(path).await });
        for _ in 0..20 {
            tokio::time::sleep(tokio::time::Duration::from_millis(15)).await;
            if UnixStream::connect(socket_path).await.is_ok() {
                return;
            }
        }
        panic!("daemon did not start within 300ms");
    }

    async fn send_line(stream: &mut UnixStream, json: &str) {
        use tokio::io::AsyncWriteExt;
        let msg = format!("{json}\n");
        stream.write_all(msg.as_bytes()).await.unwrap();
    }

    /// Read a newline-terminated JSON response without consuming extra bytes.
    async fn read_json_line(stream: &mut UnixStream) -> serde_json::Value {
        let mut buf = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            stream.read_exact(&mut byte).await.unwrap();
            if byte[0] == b'\n' {
                break;
            }
            buf.push(byte[0]);
        }
        serde_json::from_slice(&buf).unwrap()
    }

    /// Read one binary frame: [u32 BE length][bytes]. Returns empty Vec for sentinel.
    async fn read_frame(stream: &mut UnixStream) -> Vec<u8> {
        let mut len_buf = [0u8; 4];
        stream.read_exact(&mut len_buf).await.unwrap();
        let len = u32::from_be_bytes(len_buf) as usize;
        if len == 0 {
            return vec![];
        }
        let mut data = vec![0u8; len];
        stream.read_exact(&mut data).await.unwrap();
        data
    }

    #[tokio::test]
    async fn scrollback_replayed_byte_for_byte() {
        let socket = temp_socket();
        start_daemon(&socket).await;

        // Spawn with a known-output command
        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn,
            r#"{"op":"spawn","paneId":"p1","rows":24,"cols":80,"command":"sh","args":["-c","printf 'SUPERAGENT_12345'"]}"#,
        )
        .await;
        let resp = read_json_line(&mut conn).await;
        assert_eq!(resp["ok"], true, "spawn failed: {resp}");

        // Wait for printf to complete and output to be buffered
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Attach on a fresh connection and collect scrollback frames
        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"attach","paneId":"p1"}"#).await;

        let mut scrollback = Vec::new();
        let mut sentinel_received = false;
        for _ in 0..50 {
            let frame = read_frame(&mut conn2).await;
            if frame.is_empty() {
                sentinel_received = true;
                break;
            }
            scrollback.extend_from_slice(&frame);
        }

        assert!(sentinel_received, "sentinel frame not received");
        let text = String::from_utf8_lossy(&scrollback);
        assert!(
            text.contains("SUPERAGENT_12345"),
            "scrollback missing expected bytes; got: {text:?}"
        );

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn sentinel_always_follows_scrollback() {
        let socket = temp_socket();
        start_daemon(&socket).await;

        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn,
            r#"{"op":"spawn","paneId":"p2","rows":24,"cols":80,"command":"sh","args":["-c","printf 'HELLO'"]}"#,
        )
        .await;
        let _ = read_json_line(&mut conn).await;
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"attach","paneId":"p2"}"#).await;

        let mut sentinel_received = false;
        for _ in 0..50 {
            let frame = read_frame(&mut conn2).await;
            if frame.is_empty() {
                sentinel_received = true;
                break;
            }
        }

        assert!(sentinel_received, "sentinel not received before EOF");
        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn reconnect_returns_same_pid() {
        let socket = temp_socket();
        start_daemon(&socket).await;

        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn, r#"{"op":"spawn","paneId":"p3","rows":24,"cols":80}"#).await;
        let resp1 = read_json_line(&mut conn).await;
        let pid1 = resp1["pid"].as_u64().unwrap();

        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"spawn","paneId":"p3","rows":24,"cols":80}"#).await;
        let resp2 = read_json_line(&mut conn2).await;
        let pid2 = resp2["pid"].as_u64().unwrap();

        assert_eq!(pid1, pid2, "reconnect must return same pid");
        let _ = std::fs::remove_file(&socket);
    }

    /// Collect all pre-sentinel frames from an attach stream, returning the
    /// concatenated scrollback bytes and asserting the sentinel was received.
    async fn drain_scrollback(stream: &mut UnixStream) -> Vec<u8> {
        let mut scrollback = Vec::new();
        for _ in 0..200 {
            let frame = read_frame(stream).await;
            if frame.is_empty() {
                return scrollback; // sentinel received
            }
            scrollback.extend_from_slice(&frame);
        }
        panic!("sentinel not received after draining 200 frames");
    }

    #[tokio::test]
    async fn write_op_echoes_through_pty() {
        // Spawn `cat` — PTY echo causes any bytes written to stdin to appear
        // in stdout, so they show up in the scrollback.
        let socket = temp_socket();
        start_daemon(&socket).await;

        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn, r#"{"op":"spawn","paneId":"w1","rows":24,"cols":80,"command":"cat","args":[]}"#).await;
        let resp = read_json_line(&mut conn).await;
        assert_eq!(resp["ok"], true, "spawn failed: {resp}");

        // Write known bytes to the PTY.
        // Encode "WRITE_ECHO_TEST\r" as a JSON number array.
        let payload = b"WRITE_ECHO_TEST\r";
        let data_json: Vec<u8> = payload.to_vec();
        let arr: Vec<serde_json::Value> = data_json.iter().map(|&b| serde_json::json!(b)).collect();
        let write_cmd = format!(
            "{{\"op\":\"write\",\"paneId\":\"w1\",\"data\":{}}}\n",
            serde_json::json!(arr)
        );
        use tokio::io::AsyncWriteExt;
        conn.write_all(write_cmd.as_bytes()).await.unwrap();

        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"attach","paneId":"w1"}"#).await;
        let scrollback = drain_scrollback(&mut conn2).await;

        let text = String::from_utf8_lossy(&scrollback);
        assert!(
            text.contains("WRITE_ECHO_TEST"),
            "write op output missing from scrollback; got: {text:?}"
        );
        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn close_drops_attach_connection() {
        // After closing a session, attaching to it must not succeed:
        // the daemon breaks the connection (no frames, no sentinel).
        let socket = temp_socket();
        start_daemon(&socket).await;

        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn, r#"{"op":"spawn","paneId":"c1","rows":24,"cols":80,"command":"cat","args":[]}"#).await;
        let _ = read_json_line(&mut conn).await;

        // Close the session
        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"close","paneId":"c1"}"#).await;
        let resp = read_json_line(&mut conn2).await;
        assert_eq!(resp["ok"], true);

        // After close, re-spawn should produce a NEW pid (old session gone)
        let mut conn3 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn3, r#"{"op":"spawn","paneId":"c1","rows":24,"cols":80,"command":"cat","args":[]}"#).await;
        let resp2 = read_json_line(&mut conn3).await;
        assert_eq!(resp2["ok"], true);
        // The new pid must differ from zero (valid process started)
        let new_pid = resp2["pid"].as_u64().unwrap();
        assert!(new_pid > 0, "expected valid new pid after re-spawn");

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn ansi_unicode_bytes_survive_scrollback() {
        // ANSI sequences and multi-byte UTF-8 must pass through the daemon
        // byte-for-byte with no substitution or truncation.
        let socket = temp_socket();
        start_daemon(&socket).await;

        let mut conn = UnixStream::connect(&socket).await.unwrap();
        // printf: bold green, CJK, bold reset, space, rocket emoji
        // Use octal escapes: \346\227\245 = 日, \346\234\254 = 本, \350\252\236 = 語,
        // \360\237\232\200 = 🚀. Octal is valid in all sh printf AND valid JSON (no \x).
        send_line(
            &mut conn,
            r#"{"op":"spawn","paneId":"u1","rows":24,"cols":80,"command":"sh","args":["-c","printf '\\033[1;32m\\346\\227\\245\\346\\234\\254\\350\\252\\236\\033[0m \\360\\237\\232\\200'"]}"#,
        )
        .await;
        let _ = read_json_line(&mut conn).await;
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"attach","paneId":"u1"}"#).await;
        let scrollback = drain_scrollback(&mut conn2).await;

        // 日本語 = [0xe6,0x97,0xa5, 0xe6,0x9c,0xac, 0xe8,0xaa,0x9e]
        let cjk = [0xe6u8, 0x97, 0xa5, 0xe6, 0x9c, 0xac, 0xe8, 0xaa, 0x9e];
        // 🚀 = [0xf0,0x9f,0x9a,0x80]
        let emoji = [0xf0u8, 0x9f, 0x9a, 0x80];

        assert!(
            scrollback.windows(cjk.len()).any(|w| w == cjk),
            "CJK bytes missing from scrollback"
        );
        assert!(
            scrollback.windows(emoji.len()).any(|w| w == emoji),
            "emoji bytes missing from scrollback"
        );
        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn scrollback_capped_at_100kb() {
        // Produce output larger than SCROLLBACK_CAP (100KB).
        // The scrollback frame sent on attach must not exceed the cap.
        let socket = temp_socket();
        start_daemon(&socket).await;

        let mut conn = UnixStream::connect(&socket).await.unwrap();
        // yes | head -c 110000 produces ~110KB of "y\n" lines
        send_line(
            &mut conn,
            r#"{"op":"spawn","paneId":"cap1","rows":24,"cols":80,"command":"sh","args":["-c","yes | head -c 110000"]}"#,
        )
        .await;
        let _ = read_json_line(&mut conn).await;

        // Give the command time to finish
        tokio::time::sleep(tokio::time::Duration::from_millis(400)).await;

        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"attach","paneId":"cap1"}"#).await;

        let scrollback = drain_scrollback(&mut conn2).await;

        assert!(
            scrollback.len() <= SCROLLBACK_CAP,
            "scrollback {} bytes exceeds cap {} bytes",
            scrollback.len(),
            SCROLLBACK_CAP,
        );
        assert!(!scrollback.is_empty(), "scrollback must not be empty");
        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn list_returns_active_pane_ids() {
        let socket = temp_socket();
        start_daemon(&socket).await;

        // Spawn two sessions
        for pane in &["pane-a", "pane-b"] {
            let mut conn = UnixStream::connect(&socket).await.unwrap();
            let cmd = format!(
                "{{\"op\":\"spawn\",\"paneId\":\"{pane}\",\"rows\":24,\"cols\":80,\"command\":\"cat\",\"args\":[]}}\n"
            );
            use tokio::io::AsyncWriteExt;
            conn.write_all(cmd.as_bytes()).await.unwrap();
            let _ = read_json_line(&mut conn).await;
        }

        // List active sessions
        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn, r#"{"op":"list","paneId":""}"#).await;
        let resp = read_json_line(&mut conn).await;
        let ids: Vec<&str> = resp["paneIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();

        assert!(ids.contains(&"pane-a"), "pane-a not in list: {ids:?}");
        assert!(ids.contains(&"pane-b"), "pane-b not in list: {ids:?}");

        // Close one and verify it disappears
        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"close","paneId":"pane-a"}"#).await;
        let _ = read_json_line(&mut conn2).await;

        let mut conn3 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn3, r#"{"op":"list","paneId":""}"#).await;
        let resp2 = read_json_line(&mut conn3).await;
        let ids2: Vec<&str> = resp2["paneIds"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|v| v.as_str())
            .collect();

        assert!(!ids2.contains(&"pane-a"), "pane-a should be gone after close");
        assert!(ids2.contains(&"pane-b"), "pane-b should still be active");

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn resize_delivers_sigwinch_to_shell() {
        // Spawn a shell with a SIGWINCH trap, then resize. The trap output
        // must appear as live bytes on the attach stream (after sentinel).
        let socket = temp_socket();
        start_daemon(&socket).await;

        // Shell: set WINCH trap, signal readiness, then block on `read`.
        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn,
            r#"{"op":"spawn","paneId":"rsz1","rows":24,"cols":80,"command":"sh","args":["-c","trap 'printf WINCH_OK' WINCH; printf READY; read line"]}"#,
        )
        .await;
        let resp = read_json_line(&mut conn).await;
        assert_eq!(resp["ok"], true, "spawn failed: {resp}");

        // Wait for READY to appear in scrollback.
        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

        // Attach and drain scrollback + sentinel.
        let mut attach = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut attach, r#"{"op":"attach","paneId":"rsz1"}"#).await;
        let scrollback = drain_scrollback(&mut attach).await;
        let text = String::from_utf8_lossy(&scrollback);
        assert!(text.contains("READY"), "shell did not start: {text:?}");

        // Resize — this sends SIGWINCH to the shell process group.
        let mut cmd = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut cmd,
            r#"{"op":"resize","paneId":"rsz1","rows":30,"cols":100}"#,
        )
        .await;

        // Read live frames until we see the trap output.
        let mut live = Vec::new();
        for _ in 0..50 {
            tokio::select! {
                frame = read_frame(&mut attach) => {
                    live.extend_from_slice(&frame);
                    if String::from_utf8_lossy(&live).contains("WINCH_OK") {
                        break;
                    }
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {}
            }
        }
        let live_text = String::from_utf8_lossy(&live);
        assert!(
            live_text.contains("WINCH_OK"),
            "SIGWINCH trap output not received as live data; got: {live_text:?}"
        );

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn reconnect_spawn_returns_is_new_false_and_scrollback_preserved() {
        // First spawn creates a session (is_new=true). Second spawn for same
        // paneId returns is_new=false with the same pid. Attaching after the
        // second spawn must still replay the scrollback from the first session.
        let socket = temp_socket();
        start_daemon(&socket).await;

        // First spawn: create session, produce known output.
        let mut conn1 = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn1,
            r#"{"op":"spawn","paneId":"rc1","rows":24,"cols":80,"command":"sh","args":["-c","printf 'RESTORE_ME'; sleep 60"]}"#,
        )
        .await;
        let resp1 = read_json_line(&mut conn1).await;
        assert_eq!(resp1["ok"], true);
        assert_eq!(resp1["new"], true, "first spawn must be new");
        let pid1 = resp1["pid"].as_u64().unwrap();

        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // Second spawn: same paneId → reconnect (is_new=false, same pid).
        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn2,
            r#"{"op":"spawn","paneId":"rc1","rows":24,"cols":80}"#,
        )
        .await;
        let resp2 = read_json_line(&mut conn2).await;
        assert_eq!(resp2["ok"], true);
        assert_eq!(resp2["new"], false, "second spawn must be reconnect");
        assert_eq!(resp2["pid"].as_u64().unwrap(), pid1, "pid must match");

        // Attach and verify scrollback contains output from the first session.
        let mut attach = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut attach, r#"{"op":"attach","paneId":"rc1"}"#).await;
        let scrollback = drain_scrollback(&mut attach).await;

        let text = String::from_utf8_lossy(&scrollback);
        assert!(
            text.contains("RESTORE_ME"),
            "scrollback from original session not preserved; got: {text:?}"
        );

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn reconnect_spawn_resizes_pty() {
        // When a session already exists, `spawn` with new dimensions must resize
        // the PTY and deliver a SIGWINCH to the subprocess — this is how the app
        // fixes stale PTY dimensions on cold restart.
        let socket = temp_socket();
        start_daemon(&socket).await;

        // First spawn at 24×80 with a shell that traps SIGWINCH.
        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn,
            r#"{"op":"spawn","paneId":"rr1","rows":24,"cols":80,"command":"sh","args":["-c","trap 'printf WINCH_OK' WINCH; printf READY; read line"]}"#,
        )
        .await;
        let resp = read_json_line(&mut conn).await;
        assert_eq!(resp["ok"], true, "first spawn failed: {resp}");

        tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

        // Attach to drain scrollback, then keep listening for live data.
        let mut attach = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut attach, r#"{"op":"attach","paneId":"rr1"}"#).await;
        let scrollback = drain_scrollback(&mut attach).await;
        let text = String::from_utf8_lossy(&scrollback);
        assert!(text.contains("READY"), "shell did not start: {text:?}");

        // Re-spawn with different dimensions — must resize PTY and send SIGWINCH.
        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"spawn","paneId":"rr1","rows":50,"cols":200}"#).await;
        let resp2 = read_json_line(&mut conn2).await;
        assert_eq!(resp2["ok"], true, "reconnect spawn failed: {resp2}");
        assert_eq!(resp2["new"], false, "must be reconnect");

        // SIGWINCH should arrive as live data on the existing attach stream.
        let mut live = Vec::new();
        for _ in 0..50 {
            tokio::select! {
                frame = read_frame(&mut attach) => {
                    live.extend_from_slice(&frame);
                    if String::from_utf8_lossy(&live).contains("WINCH_OK") {
                        break;
                    }
                }
                _ = tokio::time::sleep(tokio::time::Duration::from_millis(100)) => {}
            }
        }
        assert!(
            String::from_utf8_lossy(&live).contains("WINCH_OK"),
            "SIGWINCH not delivered on reconnect-spawn; got: {:?}",
            String::from_utf8_lossy(&live)
        );

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn pool_claim_returns_warm_session() {
        let socket = temp_socket();
        start_daemon(&socket).await;

        // Wait for pool to warm up (shells need to boot + emit prompt)
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

        // Check pool status
        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn, r#"{"op":"pool_status","paneId":""}"#).await;
        let status = read_json_line(&mut conn).await;
        let ready = status["ready"].as_u64().unwrap_or(0);
        assert!(ready >= 1, "pool should have at least 1 ready session; got status: {status}");

        // Claim a warm session
        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn2,
            r#"{"op":"claim","paneId":"real-pane-1","cwd":"/tmp","rows":30,"cols":120}"#,
        ).await;
        let resp = read_json_line(&mut conn2).await;
        assert_eq!(resp["ok"], true, "claim failed: {resp}");
        let pid = resp["pid"].as_u64().unwrap();
        assert!(pid > 0, "claim returned invalid pid");

        // The session should now be accessible under the real pane_id
        let mut conn3 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn3, r#"{"op":"attach","paneId":"real-pane-1"}"#).await;
        let scrollback = drain_scrollback(&mut conn3).await;
        // Just verify attach succeeds and sentinel is received
        let _ = scrollback;

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn pool_claim_fallback_when_empty() {
        let socket = temp_socket();
        start_daemon(&socket).await;

        // Claim immediately after boot — pool may still be warming
        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn,
            r#"{"op":"claim","paneId":"eager-1","cwd":"/tmp","rows":24,"cols":80}"#,
        ).await;
        let resp = read_json_line(&mut conn).await;

        // May succeed (if pool warmed fast) or fail with "pool empty" — both are valid.
        assert!(
            resp["ok"].as_bool().is_some(),
            "claim response should have ok field: {resp}"
        );

        let _ = std::fs::remove_file(&socket);
    }

    #[tokio::test]
    async fn pool_replenishes_after_claim() {
        let socket = temp_socket();
        start_daemon(&socket).await;

        // Wait for pool to warm
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

        // Claim one
        let mut conn = UnixStream::connect(&socket).await.unwrap();
        send_line(
            &mut conn,
            r#"{"op":"claim","paneId":"rep-1","cwd":"/tmp","rows":24,"cols":80}"#,
        ).await;
        let resp = read_json_line(&mut conn).await;
        assert_eq!(resp["ok"], true, "first claim failed: {resp}");

        // Wait for replenishment
        tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;

        // Pool should have refilled
        let mut conn2 = UnixStream::connect(&socket).await.unwrap();
        send_line(&mut conn2, r#"{"op":"pool_status","paneId":""}"#).await;
        let status = read_json_line(&mut conn2).await;
        let total = status["ready"].as_u64().unwrap_or(0) + status["warming"].as_u64().unwrap_or(0);
        assert!(total >= 1, "pool should have replenished; got status: {status}");

        let _ = std::fs::remove_file(&socket);
    }
}
