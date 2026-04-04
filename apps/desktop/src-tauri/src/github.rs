use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};

// ── Constants ─────────────────────────────────────────────────────────

const KEYCHAIN_SERVICE: &str = "com.superagent.app";
const KEYCHAIN_USER: &str = "github-oauth-token";

// ── Shared state ─────────────────────────────────────────────────────

pub struct PollCancelFlag(pub AtomicBool);

pub struct HttpClient(pub reqwest::Client);

fn client_id() -> Result<String, String> {
    option_env!("SUPERAGENT_GITHUB_CLIENT_ID")
        .map(String::from)
        .ok_or_else(|| "SUPERAGENT_GITHUB_CLIENT_ID not set at build time".into())
}

// ── Types ─────────────────────────────────────────────────────────────

// GitHub sends snake_case; Tauri IPC serializes camelCase for the frontend.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct TokenSuccessResponse {
    pub access_token: String,
    pub token_type: String,
    pub scope: String,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct TokenErrorResponse {
    pub error: String,
    pub error_description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubConnection {
    pub username: String,
    pub avatar_url: String,
}

// ── PR Status types ──────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum PrState {
    Open,
    Draft,
    Merged,
    Closed,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrInfo {
    pub branch: String,
    pub number: u32,
    pub state: PrState,
    pub url: String,
}

// ── Search query builder ─────────────────────────────────────────────

const SEARCH_QUERY_MAX_LEN: usize = 256;

/// Build GitHub search queries for PR lookup. Chunks branch lists to stay under
/// the ~256-char search query limit. Branch names are always quoted.
pub fn build_search_queries(owner_repo: &str, branches: &[String]) -> Vec<String> {
    if branches.is_empty() {
        return Vec::new();
    }

    let prefix = format!("is:pr repo:{owner_repo} ");
    let mut queries = Vec::new();
    let mut current = prefix.clone();

    for branch in branches {
        let term = format!("head:\"{branch}\" ");
        if current.len() + term.len() > SEARCH_QUERY_MAX_LEN && current.len() > prefix.len() {
            queries.push(current.trim_end().to_string());
            current = prefix.clone();
        }
        current.push_str(&term);
    }

    if current.len() > prefix.len() {
        queries.push(current.trim_end().to_string());
    }

    queries
}

/// Parse PR nodes from a GraphQL search response alias (e.g., "s0").
pub fn parse_search_results(response: &serde_json::Value, alias: &str) -> Vec<PrInfo> {
    let edges = match response.pointer(&format!("/data/{alias}/edges")) {
        Some(serde_json::Value::Array(arr)) => arr,
        _ => return Vec::new(),
    };

    edges
        .iter()
        .filter_map(|edge| {
            let node = edge.get("node")?;
            let head_ref = node.get("headRefName")?.as_str()?;
            let number = node.get("number")?.as_u64()? as u32;
            let state_str = node.get("state")?.as_str()?;
            let is_draft = node.get("isDraft").and_then(|v| v.as_bool()).unwrap_or(false);
            let url = node.get("url")?.as_str()?.to_string();

            let state = match (state_str, is_draft) {
                ("OPEN", true) => PrState::Draft,
                ("OPEN", false) => PrState::Open,
                ("MERGED", _) => PrState::Merged,
                ("CLOSED", _) => PrState::Closed,
                _ => return None,
            };

            Some(PrInfo {
                branch: head_ref.to_string(),
                number,
                state,
                url,
            })
        })
        .collect()
}

// ── Keychain helpers (via `security` CLI to avoid per-binary ACL prompts) ─

fn store_token(token: &str) -> Result<(), String> {
    // Note: token is visible in process args for a few ms. Acceptable tradeoff
    // for a local desktop app vs. the keyring crate's per-binary ACL prompts.
    let output = std::process::Command::new("security")
        .args([
            "add-generic-password",
            "-s", KEYCHAIN_SERVICE,
            "-a", KEYCHAIN_USER,
            "-w", token,
            "-U", // update if exists
        ])
        .output()
        .map_err(|e| format!("keychain store error: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "keychain store error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

fn load_token() -> Result<Option<String>, String> {
    let output = std::process::Command::new("security")
        .args(["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_USER, "-w"])
        .output()
        .map_err(|e| format!("keychain load error: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("could not be found") {
            return Ok(None);
        }
        return Err(format!("keychain load error: {stderr}"));
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if token.is_empty() {
        Ok(None)
    } else {
        Ok(Some(token))
    }
}

fn delete_token() -> Result<(), String> {
    let output = std::process::Command::new("security")
        .args(["delete-generic-password", "-s", KEYCHAIN_SERVICE, "-a", KEYCHAIN_USER])
        .output()
        .map_err(|e| format!("keychain delete error: {e}"))?;

    // Ignore "item not found" errors
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if !stderr.contains("could not be found") {
            return Err(format!("keychain delete error: {stderr}"));
        }
    }
    Ok(())
}

// ── HTTP helpers ──────────────────────────────────────────────────────

pub fn build_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("Superagent-Desktop/0.1")
        .build()
        .expect("failed to build HTTP client")
}

async fn fetch_github_user(client: &reqwest::Client, token: &str) -> Result<GitHubConnection, String> {
    #[derive(Deserialize)]
    struct GhUser {
        login: String,
        avatar_url: String,
    }

    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("GitHub API error: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        let code = status.as_u16();
        return Err(format!("github_api_error:{code}"));
    }

    let user: GhUser = resp.json().await.map_err(|e| format!("parse error: {e}"))?;
    Ok(GitHubConnection {
        username: user.login,
        avatar_url: user.avatar_url,
    })
}

fn is_auth_error(e: &str) -> bool {
    e.starts_with("github_api_error:401") || e.starts_with("github_api_error:403")
}

// ── Tauri commands ────────────────────────────────────────────────────

#[tauri::command]
pub async fn github_start_device_flow(http: tauri::State<'_, HttpClient>) -> Result<DeviceCodeResponse, String> {
    let cid = client_id()?;

    let resp = http.0
        .post("https://github.com/login/device/code")
        .header("Accept", "application/json")
        .form(&[("client_id", cid.as_str()), ("scope", "repo:status read:user")])
        .send()
        .await
        .map_err(|e| format!("device flow request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GitHub returned {status}: {body}"));
    }

    resp.json::<DeviceCodeResponse>()
        .await
        .map_err(|e| format!("parse error: {e}"))
}

#[tauri::command]
pub async fn github_cancel_poll(flag: tauri::State<'_, PollCancelFlag>) -> Result<(), String> {
    flag.0.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub async fn github_poll_token(device_code: String, interval: u64, expires_in: u64, flag: tauri::State<'_, PollCancelFlag>, http: tauri::State<'_, HttpClient>) -> Result<GitHubConnection, String> {
    flag.0.store(false, Ordering::Relaxed);
    let cid = client_id()?;
    let mut poll_interval = std::time::Duration::from_secs(interval.max(5));
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(expires_in);

    loop {
        if flag.0.load(Ordering::Relaxed) {
            return Err("Polling cancelled.".into());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err("Device code expired. Please try again.".into());
        }
        tokio::time::sleep(poll_interval).await;

        let resp = http.0
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", cid.as_str()),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .await
            .map_err(|e| format!("token poll failed: {e}"))?;

        let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

        if let Ok(success) = serde_json::from_str::<TokenSuccessResponse>(&body) {
            store_token(&success.access_token)?;
            return fetch_github_user(&http.0, &success.access_token).await;
        }

        let error: TokenErrorResponse =
            serde_json::from_str(&body).map_err(|e| format!("unexpected response: {e}"))?;

        match error.error.as_str() {
            "authorization_pending" => continue,
            "slow_down" => {
                poll_interval += std::time::Duration::from_secs(5);
                continue;
            }
            "expired_token" => return Err("Device code expired. Please try again.".into()),
            "access_denied" => return Err("Authorization was denied by the user.".into()),
            other => return Err(format!("GitHub auth error: {other}")),
        }
    }
}

#[tauri::command]
pub async fn github_get_connection(http: tauri::State<'_, HttpClient>) -> Result<Option<GitHubConnection>, String> {
    let token = match load_token()? {
        Some(t) => t,
        None => return Ok(None),
    };

    match fetch_github_user(&http.0, &token).await {
        Ok(conn) => Ok(Some(conn)),
        Err(e) => {
            if is_auth_error(&e) {
                let _ = delete_token();
            }
            Ok(None)
        }
    }
}

#[tauri::command]
pub async fn github_disconnect() -> Result<(), String> {
    delete_token()
}

// ── Tests ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_device_code_response() {
        let json = r#"{
            "device_code": "3584d83530557fdd1f46af8289938c8ef79f9dc5",
            "user_code": "WDJB-MJHT",
            "verification_uri": "https://github.com/login/device",
            "expires_in": 899,
            "interval": 5
        }"#;
        let resp: DeviceCodeResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.user_code, "WDJB-MJHT");
        assert_eq!(resp.interval, 5);
        assert_eq!(resp.verification_uri, "https://github.com/login/device");
    }

    #[test]
    fn parse_token_success_response() {
        let json = r#"{
            "access_token": "gho_16C7e42F292c6912E7710c838347Ae178B4a",
            "token_type": "bearer",
            "scope": "repo"
        }"#;
        let resp: TokenSuccessResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.access_token, "gho_16C7e42F292c6912E7710c838347Ae178B4a");
        assert_eq!(resp.token_type, "bearer");
    }

    #[test]
    fn parse_token_error_response() {
        let json = r#"{
            "error": "authorization_pending",
            "error_description": "The authorization request is still pending."
        }"#;
        let resp: TokenErrorResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.error, "authorization_pending");
    }

    #[test]
    fn parse_token_error_without_description() {
        let json = r#"{"error": "slow_down"}"#;
        let resp: TokenErrorResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.error, "slow_down");
        assert!(resp.error_description.is_none());
    }

    #[test]
    fn pr_state_serializes_screaming_snake() {
        assert_eq!(serde_json::to_string(&PrState::Open).unwrap(), "\"OPEN\"");
        assert_eq!(serde_json::to_string(&PrState::Draft).unwrap(), "\"DRAFT\"");
        assert_eq!(serde_json::to_string(&PrState::Merged).unwrap(), "\"MERGED\"");
        assert_eq!(serde_json::to_string(&PrState::Closed).unwrap(), "\"CLOSED\"");
    }

    #[test]
    fn pr_info_serializes_camel_case() {
        let info = PrInfo {
            branch: "feat/test".to_string(),
            number: 42,
            state: PrState::Open,
            url: "https://github.com/nept/superagent/pull/42".to_string(),
        };
        let json: serde_json::Value = serde_json::to_value(&info).unwrap();
        assert_eq!(json["branch"], "feat/test");
        assert_eq!(json["number"], 42);
        assert_eq!(json["state"], "OPEN");
        assert_eq!(json["url"], "https://github.com/nept/superagent/pull/42");
    }

    #[test]
    fn build_search_queries_single_branch() {
        let queries = build_search_queries("nept/superagent", &["main".to_string()]);
        assert_eq!(queries.len(), 1);
        assert_eq!(queries[0], "is:pr repo:nept/superagent head:\"main\"");
    }

    #[test]
    fn build_search_queries_multiple_branches() {
        let branches: Vec<String> = (0..5).map(|i| format!("branch-{i}")).collect();
        let queries = build_search_queries("nept/superagent", &branches);
        assert_eq!(queries.len(), 1);
        let q = &queries[0];
        assert!(q.starts_with("is:pr repo:nept/superagent "));
        for b in &branches {
            assert!(q.contains(&format!("head:\"{b}\"")));
        }
    }

    #[test]
    fn build_search_queries_chunks_long_branch_lists() {
        let branches: Vec<String> = (0..30).map(|i| format!("feature/very-long-branch-name-{i:03}")).collect();
        let queries = build_search_queries("nept/superagent", &branches);
        assert!(queries.len() > 1, "Should split into multiple queries");
        let mut found: Vec<String> = Vec::new();
        for q in &queries {
            assert!(q.starts_with("is:pr repo:nept/superagent "));
            for b in &branches {
                if q.contains(&format!("head:\"{b}\"")) {
                    found.push(b.clone());
                }
            }
        }
        found.sort();
        let mut expected = branches.clone();
        expected.sort();
        assert_eq!(found, expected);
    }

    #[test]
    fn build_search_queries_quotes_special_chars() {
        let branches = vec!["feat/my-branch".to_string(), "fix/issue#42".to_string()];
        let queries = build_search_queries("nept/superagent", &branches);
        assert_eq!(queries.len(), 1);
        assert!(queries[0].contains("head:\"feat/my-branch\""));
        assert!(queries[0].contains("head:\"fix/issue#42\""));
    }

    #[test]
    fn build_search_queries_empty_branches() {
        let queries = build_search_queries("nept/superagent", &[]);
        assert!(queries.is_empty());
    }

    #[test]
    fn parse_graphql_pr_response() {
        let json = r#"{
            "data": {
                "s0": {
                    "edges": [
                        {
                            "node": {
                                "number": 42,
                                "state": "OPEN",
                                "headRefName": "feat/dark-mode",
                                "url": "https://github.com/nept/superagent/pull/42",
                                "isDraft": false
                            }
                        },
                        {
                            "node": {
                                "number": 43,
                                "state": "OPEN",
                                "headRefName": "feat/pr-badges",
                                "url": "https://github.com/nept/superagent/pull/43",
                                "isDraft": true
                            }
                        },
                        {
                            "node": {
                                "number": 30,
                                "state": "MERGED",
                                "headRefName": "fix/sidebar",
                                "url": "https://github.com/nept/superagent/pull/30",
                                "isDraft": false
                            }
                        }
                    ]
                }
            }
        }"#;
        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let prs = parse_search_results(&value, "s0");
        assert_eq!(prs.len(), 3);

        assert_eq!(prs[0].branch, "feat/dark-mode");
        assert_eq!(prs[0].number, 42);
        assert_eq!(prs[0].state, PrState::Open);

        assert_eq!(prs[1].branch, "feat/pr-badges");
        assert_eq!(prs[1].state, PrState::Draft);

        assert_eq!(prs[2].branch, "fix/sidebar");
        assert_eq!(prs[2].state, PrState::Merged);
    }

    #[test]
    fn client_id_from_env() {
        let result = client_id();
        if option_env!("SUPERAGENT_GITHUB_CLIENT_ID").is_some() {
            assert!(result.is_ok());
        } else {
            assert!(result.unwrap_err().contains("not set"));
        }
    }
}
