use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusResult {
    pub prs: HashMap<String, Vec<PrInfo>>,
    /// Repo paths where the GitHub API returned access errors (FORBIDDEN, NOT_FOUND).
    /// Frontend should skip these on subsequent polls until re-auth.
    pub inaccessible_paths: Vec<String>,
}

// ── Search query builder ─────────────────────────────────────────────

/// Build GitHub search queries for PR lookup. Chunks branch lists to stay under
/// the ~256-char search query limit. Branch names are always quoted.
pub fn build_search_queries(owner_repo: &str, branches: &[String]) -> Vec<String> {
    // Each branch must be a separate search query because GitHub search
    // treats multiple `head:` qualifiers as AND (not OR).
    branches
        .iter()
        .map(|branch| format!("is:pr repo:{owner_repo} head:\"{branch}\""))
        .collect()
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

// ── PR Status command ────────────────────────────────────────────────────────

const MAX_ALIASES_PER_REQUEST: usize = 30;

/// Build one GraphQL query body containing multiple aliased search calls.
fn build_aliased_graphql(alias_queries: &[(String, String)]) -> String {
    let mut body = String::from("{ ");
    for (alias, search_query) in alias_queries {
        let escaped = search_query.replace('"', "\\\"");
        body.push_str(&format!(
            r#"{alias}: search(query: "{escaped}", type: ISSUE, first: 100) {{ edges {{ node {{ ... on PullRequest {{ number state headRefName url isDraft }} }} }} }} "#
        ));
    }
    body.push('}');
    body
}

async fn execute_graphql(
    client: &reqwest::Client,
    token: &str,
    query: &str,
) -> Result<serde_json::Value, String> {
    let body = serde_json::json!({ "query": query });
    let resp = client
        .post("https://api.github.com/graphql")
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("GraphQL request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("GraphQL HTTP {}", status.as_u16()));
    }

    let value: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("GraphQL parse error: {e}"))?;

    // GitHub GraphQL returns 200 even for errors — log unique error types once
    if let Some(serde_json::Value::Array(errors)) = value.get("errors") {
        // Deduplicate by error type to avoid spamming console every poll cycle
        let mut seen = std::collections::HashSet::new();
        for err in errors {
            let err_type = err.get("type").and_then(|t| t.as_str()).unwrap_or("UNKNOWN");
            if seen.insert(err_type.to_string()) {
                let msg = err.get("message").and_then(|m| m.as_str()).unwrap_or("(no message)");
                eprintln!("github_get_pr_statuses: {err_type}: {msg}");
            }
        }
    }

    Ok(value)
}

async fn execute_graphql_with_retry(
    client: &reqwest::Client,
    token: &str,
    query: &str,
) -> Result<serde_json::Value, String> {
    match execute_graphql(client, token, query).await {
        Ok(v) => Ok(v),
        Err(e) => {
            if e.contains("403") || e.contains("429") || e.contains("request failed") {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                execute_graphql(client, token, query).await
            } else {
                Err(e)
            }
        }
    }
}

#[tauri::command]
pub async fn github_get_pr_statuses(
    repo_paths: Vec<String>,
    http: tauri::State<'_, HttpClient>,
) -> Result<PrStatusResult, String> {
    let token = match load_token()? {
        Some(t) => t,
        None => {
            return Ok(PrStatusResult {
                prs: HashMap::new(),
                inaccessible_paths: Vec::new(),
            });
        }
    };

    // Phase 1: Parse remotes → group by owner/repo
    let mut owner_repo_map: HashMap<String, Vec<(String, Vec<String>)>> = HashMap::new();
    let sem = Arc::new(Semaphore::new(6));
    let mut handles = Vec::new();

    for path in &repo_paths {
        let path = path.clone();
        let sem = sem.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let p = path.clone();
            let result = tokio::task::spawn_blocking(move || {
                let github_remote = crate::git::parse_github_remote(&p);
                let branches: Vec<String> = if let Ok(repo) = git2::Repository::open(&p) {
                    repo.branches(Some(git2::BranchType::Local))
                        .ok()
                        .map(|iter| {
                            iter.filter_map(|b| b.ok())
                                .filter_map(|(b, _)| b.name().ok()?.map(String::from))
                                .collect()
                        })
                        .unwrap_or_default()
                } else {
                    Vec::new()
                };
                (github_remote, branches)
            })
            .await
            .map_err(|e| e.to_string())?;
            Ok::<_, String>((path, result))
        }));
    }

    // Non-GitHub repos are not inaccessible, just irrelevant — don't include them
    for handle in handles {
        match handle.await {
            Ok(Ok((path, (Some((owner, repo)), branches)))) => {
                let key = format!("{owner}/{repo}");
                owner_repo_map.entry(key).or_default().push((path, branches));
            }
            Ok(Ok(_)) => {}
            Ok(Err(e)) => eprintln!("github_get_pr_statuses: remote parse failed: {e}"),
            Err(e) => eprintln!("github_get_pr_statuses: task panicked: {e}"),
        }
    }

    if owner_repo_map.is_empty() {
        return Ok(PrStatusResult {
            prs: HashMap::new(),
            inaccessible_paths: Vec::new(),
        });
    }

    // Phase 2: Build search queries per owner/repo (never mix repos in one batch)
    // This ensures one inaccessible org doesn't poison queries for other repos.
    let gql_sem = Arc::new(Semaphore::new(2));
    let mut gql_handles = Vec::new();
    let mut failed_owner_repos: std::collections::HashSet<String> = std::collections::HashSet::new();

    for (owner_repo, repo_entries) in &owner_repo_map {
        let mut all_branches: Vec<String> = repo_entries
            .iter()
            .flat_map(|(_, branches)| branches.iter().cloned())
            .collect();
        all_branches.sort();
        all_branches.dedup();

        let queries = build_search_queries(owner_repo, &all_branches);
        let mut aliases: Vec<(String, String)> = Vec::new();
        for (i, query) in queries.into_iter().enumerate() {
            aliases.push((format!("s{i}"), query));
        }

        // Batch aliases for this owner/repo only
        for chunk in aliases.chunks(MAX_ALIASES_PER_REQUEST) {
            let alias_queries: Vec<(String, String)> = chunk.to_vec();
            let client = http.0.clone();
            let token = token.clone();
            let sem = gql_sem.clone();
            let owner_repo = owner_repo.clone();

            gql_handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
                let query = build_aliased_graphql(&alias_queries);
                let response = execute_graphql_with_retry(&client, &token, &query).await?;

                // Check for access errors (FORBIDDEN, NOT_FOUND) in the GraphQL response
                let has_access_error = response
                    .get("errors")
                    .and_then(|e| e.as_array())
                    .map(|errors| {
                        errors.iter().any(|err| {
                            matches!(
                                err.get("type").and_then(|t| t.as_str()),
                                Some("FORBIDDEN" | "NOT_FOUND")
                            )
                        })
                    })
                    .unwrap_or(false);

                let mut prs = Vec::new();
                for (alias, _) in &alias_queries {
                    prs.extend(parse_search_results(&response, alias));
                }
                Ok::<_, String>((owner_repo, prs, has_access_error))
            }));
        }
    }

    // Phase 3: Collect results and track failures
    let mut prs_by_owner_repo: HashMap<String, Vec<PrInfo>> = HashMap::new();
    for handle in gql_handles {
        match handle.await {
            Ok(Ok((owner_repo, prs, has_access_error))) => {
                if has_access_error {
                    failed_owner_repos.insert(owner_repo.clone());
                }
                prs_by_owner_repo.entry(owner_repo).or_default().extend(prs);
            }
            Ok(Err(e)) => {
                eprintln!("github_get_pr_statuses: GraphQL request failed: {e}");
                // HTTP-level failures (403, etc.) — can't determine owner/repo here,
                // but these are retried already. Treat as transient.
            }
            Err(e) => eprintln!("github_get_pr_statuses: task panicked: {e}"),
        }
    }

    // Phase 4: Map back to repo_paths + collect inaccessible paths
    let mut result: HashMap<String, Vec<PrInfo>> = HashMap::new();
    let mut inaccessible_paths: Vec<String> = Vec::new();

    for (owner_repo, repo_entries) in &owner_repo_map {
        if failed_owner_repos.contains(owner_repo) {
            for (repo_path, _) in repo_entries {
                inaccessible_paths.push(repo_path.clone());
            }
            continue;
        }
        if let Some(all_prs) = prs_by_owner_repo.get(owner_repo) {
            for (repo_path, branches) in repo_entries {
                let branch_set: std::collections::HashSet<&str> =
                    branches.iter().map(|s| s.as_str()).collect();
                let matching: Vec<PrInfo> = all_prs
                    .iter()
                    .filter(|pr| branch_set.contains(pr.branch.as_str()))
                    .cloned()
                    .collect();
                if !matching.is_empty() {
                    result.insert(repo_path.clone(), matching);
                }
            }
        }
    }

    Ok(PrStatusResult {
        prs: result,
        inaccessible_paths,
    })
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
        .form(&[("client_id", cid.as_str()), ("scope", "repo read:user")])
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
            let scopes: Vec<&str> = success.scope.split(',').map(|s| s.trim()).collect();
            if !scopes.contains(&"repo") {
                return Err(format!(
                    "GitHub granted insufficient scopes: '{}'. The 'repo' scope is required for PR status. Please revoke the app at https://github.com/settings/applications and try again.",
                    success.scope
                ));
            }
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
        // Each branch gets its own query (GitHub AND's multiple head: qualifiers)
        assert_eq!(queries.len(), 5);
        for (i, q) in queries.iter().enumerate() {
            assert_eq!(q, &format!("is:pr repo:nept/superagent head:\"branch-{i}\""));
        }
    }

    #[test]
    fn build_search_queries_quotes_special_chars() {
        let branches = vec!["feat/my-branch".to_string(), "fix/issue#42".to_string()];
        let queries = build_search_queries("nept/superagent", &branches);
        assert_eq!(queries.len(), 2);
        assert_eq!(queries[0], "is:pr repo:nept/superagent head:\"feat/my-branch\"");
        assert_eq!(queries[1], "is:pr repo:nept/superagent head:\"fix/issue#42\"");
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
