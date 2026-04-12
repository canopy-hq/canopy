use std::sync::Mutex;

use axum::{
    extract::State as AxumState,
    http::{HeaderMap, StatusCode},
    routing::post,
    Json, Router,
};
use tauri::{AppHandle, Manager};
use tokio::net::TcpListener;

use crate::agent_watcher::{self, AgentStatus, AgentWatcherState};
use crate::pty::PtyState;

// ── Types ──────────────────────────────────────────────────────────────

/// Managed by Tauri — holds the ephemeral port and auth token.
pub struct HookServerState {
    pub port: u16,
    pub token: String,
}

#[derive(serde::Deserialize)]
struct HookPayload {
    event: String,
    pane_id: String,
    agent: Option<String>,
}

#[derive(Clone)]
struct ServerState {
    app_handle: AppHandle,
    token: String,
}

// ── Event mapping ──────────────────────────────────────────────────────

fn map_event(event: &str) -> Option<AgentStatus> {
    match event {
        "Start" => Some(AgentStatus::Working),
        "Stop" => Some(AgentStatus::Stopped),
        "Permission" => Some(AgentStatus::Permission),
        _ => None,
    }
}

// ── Handler ────────────────────────────────────────────────────────────

async fn handle_hook(
    AxumState(state): AxumState<ServerState>,
    headers: HeaderMap,
    Json(payload): Json<HookPayload>,
) -> StatusCode {
    // Validate bearer token
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let expected = format!("Bearer {}", state.token);
    if auth != expected {
        return StatusCode::UNAUTHORIZED;
    }

    let status = match map_event(&payload.event) {
        Some(s) => s,
        None => {
            eprintln!("[hook] unknown event: {}", payload.event);
            return StatusCode::BAD_REQUEST;
        }
    };

    let agent_name = payload.agent.as_deref().unwrap_or("unknown");

    // Access Tauri-managed state via the AppHandle
    if let (Some(pty_state), Some(watcher_state)) = (
        state.app_handle.try_state::<Mutex<PtyState>>(),
        state.app_handle.try_state::<Mutex<AgentWatcherState>>(),
    ) {
        agent_watcher::set_hook_status(
            &payload.pane_id,
            status,
            None,
            agent_name,
            &state.app_handle,
            &pty_state,
            &watcher_state,
        );
    }

    StatusCode::OK
}

// ── Server startup ─────────────────────────────────────────────────────

/// Start the hook HTTP server on an ephemeral port.
/// Binds synchronously (safe to call from Tauri's sync `.setup()`), then
/// spawns the async server on the tokio runtime.
/// Returns `(port, token)` for injection into PTY env vars.
pub fn start_hook_server(app_handle: AppHandle) -> Result<(u16, String), String> {
    let token = uuid::Uuid::now_v7().to_string();

    // Bind synchronously to avoid block_on deadlock in setup()
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("hook server bind failed: {e}"))?;
    std_listener
        .set_nonblocking(true)
        .map_err(|e| format!("hook server set_nonblocking: {e}"))?;
    let port = std_listener
        .local_addr()
        .map_err(|e| format!("hook server addr: {e}"))?
        .port();

    let server_state = ServerState {
        app_handle,
        token: token.clone(),
    };

    let router = Router::new()
        .route("/hook", post(handle_hook))
        .with_state(server_state);

    eprintln!("[hook] server listening on 127.0.0.1:{port}");

    // Convert std listener to tokio and spawn the server
    tokio::spawn(async move {
        let listener = match TcpListener::from_std(std_listener) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[hook] failed to convert listener: {e}");
                return;
            }
        };
        if let Err(e) = axum::serve(listener, router).await {
            eprintln!("[hook] server error: {e}");
        }
    });

    Ok((port, token))
}

// ── Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_event() {
        assert_eq!(map_event("Start"), Some(AgentStatus::Working));
        assert_eq!(map_event("Stop"), Some(AgentStatus::Stopped));
        assert_eq!(map_event("Permission"), Some(AgentStatus::Permission));
        assert_eq!(map_event("unknown"), None);
        assert_eq!(map_event(""), None);
    }
}
