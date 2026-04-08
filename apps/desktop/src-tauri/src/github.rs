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
    /// HEAD SHA of the PR branch on GitHub. Used internally for ancestry validation;
    /// not sent to the frontend.
    #[serde(skip_serializing)]
    pub head_oid: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PrStatusResult {
    pub prs: HashMap<String, Vec<PrInfo>>,
    /// Repo paths where the GitHub API returned access errors (FORBIDDEN, NOT_FOUND).
    /// Frontend should skip these on subsequent polls until re-auth.
    pub inaccessible_paths: Vec<String>,
}

// ── Repository PR query builder ─────────────────────────────────────

/// Build a GraphQL query using `repository.pullRequests(headRefName: ...)` for exact matching.
/// Each branch gets its own aliased field (b0, b1, ...) inside a single `repository` block.
/// Returns the full query string ready for `execute_graphql`.
pub fn build_repo_pr_query(owner: &str, repo: &str, branches: &[String]) -> String {
    let owner = owner.replace('\\', "\\\\").replace('"', "\\\"");
    let repo = repo.replace('\\', "\\\\").replace('"', "\\\"");
    let mut fields = String::new();
    for (i, branch) in branches.iter().enumerate() {
        let escaped = branch.replace('\\', "\\\\").replace('"', "\\\"");
        fields.push_str(&format!(
            "b{i}: pullRequests(headRefName: \"{escaped}\", first: 5, orderBy: {{field: UPDATED_AT, direction: DESC}}) {{ nodes {{ number state headRefName url isDraft headRefOid }} }} "
        ));
    }
    format!(
        "{{ repository(owner: \"{owner}\", name: \"{repo}\") {{ {fields} }} }}"
    )
}

/// Parse all PR nodes from a `repository.pullRequests` aliased response (e.g., "b0").
/// Returns up to `first` PRs per branch (OPEN, CLOSED, MERGED may coexist).
pub fn parse_pr_nodes(repo_data: &serde_json::Value, alias: &str) -> Vec<PrInfo> {
    let Some(nodes) = repo_data
        .pointer(&format!("/{alias}/nodes"))
        .and_then(|v| v.as_array())
    else {
        return Vec::new();
    };

    nodes
        .iter()
        .filter_map(|node| {
            let head_ref = node.get("headRefName")?.as_str()?;
            let number = node.get("number")?.as_u64()? as u32;
            let state_str = node.get("state")?.as_str()?;
            let is_draft = node
                .get("isDraft")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let url = node.get("url")?.as_str()?.to_string();

            let state = match (state_str, is_draft) {
                ("OPEN", true) => PrState::Draft,
                ("OPEN", false) => PrState::Open,
                ("MERGED", _) => PrState::Merged,
                ("CLOSED", _) => PrState::Closed,
                _ => return None,
            };

            let head_oid = node
                .get("headRefOid")
                .and_then(|v| v.as_str())
                .map(String::from);

            Some(PrInfo {
                branch: head_ref.to_string(),
                number,
                state,
                url,
                head_oid,
            })
        })
        .collect()
}

// ── Branch collection ────────────────────────────────────────────────────────

/// Collect branches to check for PRs: HEAD, worktree branches, and upstream-tracking branches.
/// Returns (branch_name, local_head_sha) pairs.
fn collect_tracked_branches(repo_path: &str) -> Vec<(String, String)> {
    let Ok(repo) = git2::Repository::open(repo_path) else {
        eprintln!("[github:branches] cannot open repo at {repo_path}");
        return Vec::new();
    };
    let mut seen = std::collections::HashSet::new();
    let mut result = Vec::new();

    // Always include HEAD (the main repo's checked-out branch)
    if let Some(name) = repo
        .head()
        .ok()
        .filter(|h| h.is_branch())
        .and_then(|h| h.shorthand().map(String::from))
    {
        if let Ok(branch) = repo.find_branch(&name, git2::BranchType::Local) {
            if let Some(oid) = branch.get().target() {
                seen.insert(name.clone());
                result.push((name, oid.to_string()));
            }
        }
    }

    // Include branches checked out in worktrees
    let wt_names = match repo.worktrees() {
        Ok(names) => names,
        Err(e) => {
            eprintln!("[github:branches] repo.worktrees() failed: {e}");
            return result; // Can't enumerate worktrees — return what we have so far
        }
    };
    let names: Vec<_> = wt_names.iter().flatten().collect();
    eprintln!(
        "[github:branches] {repo_path}: {} worktree(s): {:?}",
        names.len(),
        names
    );
    for wt_name in &names {
        let wt = match repo.find_worktree(wt_name) {
            Ok(wt) => wt,
            Err(e) => {
                eprintln!("[github:branches] find_worktree({wt_name}) failed: {e}");
                continue;
            }
        };
        let Some(name) = crate::git::resolve_worktree_branch(wt_name, wt.path(), &repo) else {
            eprintln!("[github:branches] worktree {wt_name}: no branch resolved");
            continue;
        };
        if seen.contains(&name) {
            eprintln!("[github:branches] worktree {wt_name}: branch {name} already seen");
            continue;
        }
        match repo.find_branch(&name, git2::BranchType::Local) {
            Ok(b) => {
                if let Some(oid) = b.get().target() {
                    seen.insert(name.clone());
                    result.push((name, oid.to_string()));
                }
            }
            Err(e) => eprintln!("[github:branches] worktree {wt_name}: find_branch failed: {e}"),
        }
    }

    // Add remaining branches that track a remote upstream
    if let Ok(iter) = repo.branches(Some(git2::BranchType::Local)) {
        for entry in iter.filter_map(|b| b.ok()) {
            let (b, _) = entry;
            if let Some(name) = b.name().ok().flatten().map(String::from) {
                if !seen.contains(&name) && b.upstream().is_ok() {
                    if let Some(oid) = b.get().target() {
                        seen.insert(name.clone());
                        result.push((name, oid.to_string()));
                    }
                }
            }
        }
    }

    eprintln!(
        "[github:branches] {repo_path}: collected {} branch(es): {:?}",
        result.len(),
        result.iter().map(|(n, _)| n.as_str()).collect::<Vec<_>>()
    );
    result
}

// ── PR Status command ────────────────────────────────────────────────────────

const MAX_ALIASES_PER_REQUEST: usize = 30;

/// Check if `ancestor_hex` is an ancestor of `descendant_hex` in the repo at `repo_path`.
/// Returns false on any error (missing commit, bad OID, etc.) — treat as "not related".
fn is_ancestor_of(repo_path: &str, ancestor_hex: &str, descendant_hex: &str) -> bool {
    let Ok(repo) = git2::Repository::open(repo_path) else {
        return false;
    };
    let Ok(ancestor) = git2::Oid::from_str(ancestor_hex) else {
        return false;
    };
    let Ok(descendant) = git2::Oid::from_str(descendant_hex) else {
        return false;
    };
    repo.graph_descendant_of(descendant, ancestor).unwrap_or(false)
}

/// Decide whether a PR should be shown for a local branch.
/// OPEN/DRAFT: always shown. MERGED: ancestry check. CLOSED: exact SHA match.
fn should_show_pr(pr: &PrInfo, local_oid: &str, repo_path: &str) -> bool {
    if pr.state == PrState::Open || pr.state == PrState::Draft {
        return true;
    }
    let Some(pr_oid) = pr.head_oid.as_deref() else {
        // headRefOid is non-nullable in GitHub's schema, so this only happens
        // with malformed data. MERGED: show (benefit of doubt). CLOSED: hide
        // (can't validate, and showing stale closed PRs is worse than missing one).
        return pr.state == PrState::Merged;
    };
    match pr.state {
        PrState::Closed => pr_oid == local_oid,
        // Exact match covers the common case where the local branch hasn't moved
        // since the PR was merged. Ancestry covers rebases/additional commits.
        PrState::Merged => pr_oid == local_oid || is_ancestor_of(repo_path, pr_oid, local_oid),
        _ => unreachable!(),
    }
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
            if e.contains("429") || e.contains("request failed") {
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
    // Each branch carries its local HEAD SHA for ancestry validation in Phase 4.
    let mut owner_repo_map: HashMap<String, Vec<(String, Vec<(String, String)>)>> = HashMap::new();
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
                let branches = collect_tracked_branches(&p);
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
        eprintln!("[github:pr] no GitHub remotes found, skipping");
        return Ok(PrStatusResult {
            prs: HashMap::new(),
            inaccessible_paths: Vec::new(),
        });
    }

    eprintln!(
        "[github:pr] polling {} repo(s): {}",
        owner_repo_map.len(),
        owner_repo_map.keys().cloned().collect::<Vec<_>>().join(", ")
    );

    // Phase 2: Build repository.pullRequests queries per owner/repo
    let gql_sem = Arc::new(Semaphore::new(2));
    let mut gql_handles = Vec::new();
    let mut failed_owner_repos: std::collections::HashSet<String> =
        std::collections::HashSet::new();

    for (owner_repo, repo_entries) in &owner_repo_map {
        let mut all_branches: Vec<String> = repo_entries
            .iter()
            .flat_map(|(_, branches)| branches.iter().map(|(name, _)| name.clone()))
            .collect();
        all_branches.sort();
        all_branches.dedup();

        if all_branches.is_empty() {
            continue;
        }

        let (owner, repo) = match owner_repo.split_once('/') {
            Some(pair) => pair,
            None => continue,
        };

        eprintln!(
            "[github:pr] {owner_repo}: {} tracked branch(es)",
            all_branches.len(),
        );

        // Chunk branches into batches of MAX_ALIASES_PER_REQUEST
        for chunk in all_branches.chunks(MAX_ALIASES_PER_REQUEST) {
            let chunk_branches: Vec<String> = chunk.to_vec();
            let branch_count = chunk_branches.len();
            let client = http.0.clone();
            let token = token.clone();
            let sem = gql_sem.clone();
            let owner_repo = owner_repo.clone();
            let owner = owner.to_string();
            let repo = repo.to_string();

            gql_handles.push(tokio::spawn(async move {
                let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
                let query = build_repo_pr_query(&owner, &repo, &chunk_branches);
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
                if let Some(repo_data) = response.pointer("/data/repository") {
                    for i in 0..branch_count {
                        prs.extend(parse_pr_nodes(repo_data, &format!("b{i}")));
                    }
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

    // Phase 4: Map back to repo_paths + collect inaccessible paths.
    // Runs in spawn_blocking because should_show_pr may call is_ancestor_of (git I/O).
    let (result, inaccessible_paths) = tokio::task::spawn_blocking(move || {
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
                    let branch_oids: HashMap<&str, &str> = branches
                        .iter()
                        .map(|(name, oid)| (name.as_str(), oid.as_str()))
                        .collect();

                    let matching: Vec<PrInfo> = all_prs
                        .iter()
                        .filter(|pr| {
                            branch_oids
                                .get(pr.branch.as_str())
                                .map_or(false, |oid| should_show_pr(pr, oid, repo_path))
                        })
                        .cloned()
                        .collect();
                    if !matching.is_empty() {
                        result.insert(repo_path.clone(), matching);
                    }
                }
            }
        }

        (result, inaccessible_paths)
    })
    .await
    .map_err(|e| format!("PR status phase 4 failed: {e}"))?;

    let total_prs: usize = result.values().map(|v| v.len()).sum();
    eprintln!(
        "[github:pr] done: {} PR(s) found, {} inaccessible path(s)",
        total_prs,
        inaccessible_paths.len()
    );

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

    /// Create a PrInfo with sensible defaults — only override what the test cares about.
    fn test_pr(state: PrState, head_oid: Option<&str>) -> PrInfo {
        PrInfo {
            branch: "feat/x".into(),
            number: 1,
            state,
            url: String::new(),
            head_oid: head_oid.map(String::from),
        }
    }

    /// Create a temp git repo with a signature and empty tree ready for commits.
    fn init_test_repo() -> (tempfile::TempDir, git2::Repository, git2::Signature<'static>, git2::Oid) {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        let tree_id = repo.index().unwrap().write_tree().unwrap();
        (dir, repo, sig, tree_id)
    }

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
            url: "https://github.com/acme/widgets/pull/42".to_string(),
            head_oid: Some("abc123".to_string()),
        };
        let json: serde_json::Value = serde_json::to_value(&info).unwrap();
        assert_eq!(json["branch"], "feat/test");
        assert_eq!(json["number"], 42);
        assert_eq!(json["state"], "OPEN");
        assert_eq!(json["url"], "https://github.com/acme/widgets/pull/42");
        // head_oid must NOT appear in serialized output (skip_serializing)
        assert!(json.get("headOid").is_none());
    }

    #[test]
    fn build_repo_pr_query_single_branch() {
        let query = build_repo_pr_query("acme", "widgets", &["sprint".to_string()]);
        assert!(query.contains(r#"repository(owner: "acme", name: "widgets")"#));
        assert!(query.contains(r#"b0: pullRequests(headRefName: "sprint""#));
        assert!(query.contains("first: 5"));
        assert!(query.contains("orderBy: {field: UPDATED_AT, direction: DESC}"));
        assert!(query.contains("nodes { number state headRefName url isDraft headRefOid }"));
    }

    #[test]
    fn build_repo_pr_query_multiple_branches() {
        let branches: Vec<String> = vec!["main".into(), "feat/foo".into(), "fix/bar".into()];
        let query = build_repo_pr_query("acme", "widgets", &branches);
        assert!(query.contains(r#"b0: pullRequests(headRefName: "main""#));
        assert!(query.contains(r#"b1: pullRequests(headRefName: "feat/foo""#));
        assert!(query.contains(r#"b2: pullRequests(headRefName: "fix/bar""#));
    }

    #[test]
    fn build_repo_pr_query_empty_branches() {
        let query = build_repo_pr_query("acme", "widgets", &[]);
        assert!(query.contains(r#"repository(owner: "acme", name: "widgets")"#));
        assert!(!query.contains("b0:"));
    }

    #[test]
    fn parse_pr_nodes_open() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "b0": {
                "nodes": [{
                    "number": 42,
                    "state": "OPEN",
                    "headRefName": "feat/dark-mode",
                    "url": "https://github.com/acme/widgets/pull/42",
                    "isDraft": false,
                    "headRefOid": "abc123def456"
                }]
            }
        }"#).unwrap();
        let prs = parse_pr_nodes(&json, "b0");
        assert_eq!(prs.len(), 1);
        assert_eq!(prs[0].branch, "feat/dark-mode");
        assert_eq!(prs[0].number, 42);
        assert_eq!(prs[0].state, PrState::Open);
        assert_eq!(prs[0].head_oid.as_deref(), Some("abc123def456"));
    }

    #[test]
    fn parse_pr_nodes_draft() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "b0": {
                "nodes": [{
                    "number": 43,
                    "state": "OPEN",
                    "headRefName": "feat/wip",
                    "url": "https://github.com/acme/widgets/pull/43",
                    "isDraft": true,
                    "headRefOid": "def789"
                }]
            }
        }"#).unwrap();
        let prs = parse_pr_nodes(&json, "b0");
        assert_eq!(prs[0].state, PrState::Draft);
    }

    #[test]
    fn parse_pr_nodes_closed() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "b0": {
                "nodes": [{
                    "number": 50,
                    "state": "CLOSED",
                    "headRefName": "feat/abandoned",
                    "url": "https://github.com/acme/widgets/pull/50",
                    "isDraft": false,
                    "headRefOid": "closed123"
                }]
            }
        }"#).unwrap();
        let prs = parse_pr_nodes(&json, "b0");
        assert_eq!(prs[0].state, PrState::Closed);
    }

    #[test]
    fn parse_pr_nodes_without_head_oid() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "b0": {
                "nodes": [{
                    "number": 99,
                    "state": "OPEN",
                    "headRefName": "feat/old",
                    "url": "https://github.com/acme/widgets/pull/99",
                    "isDraft": false
                }]
            }
        }"#).unwrap();
        let prs = parse_pr_nodes(&json, "b0");
        assert!(prs[0].head_oid.is_none());
    }

    #[test]
    fn parse_pr_nodes_multiple_prs() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "b0": {
                "nodes": [
                    {
                        "number": 10,
                        "state": "CLOSED",
                        "headRefName": "feat/x",
                        "url": "https://github.com/o/r/pull/10",
                        "isDraft": false,
                        "headRefOid": "aaa"
                    },
                    {
                        "number": 20,
                        "state": "OPEN",
                        "headRefName": "feat/x",
                        "url": "https://github.com/o/r/pull/20",
                        "isDraft": false,
                        "headRefOid": "bbb"
                    }
                ]
            }
        }"#).unwrap();
        let prs = parse_pr_nodes(&json, "b0");
        assert_eq!(prs.len(), 2);
        assert_eq!(prs[0].state, PrState::Closed);
        assert_eq!(prs[1].state, PrState::Open);
    }

    #[test]
    fn parse_pr_nodes_merged() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "b0": {
                "nodes": [{
                    "number": 30,
                    "state": "MERGED",
                    "headRefName": "fix/sidebar",
                    "url": "https://github.com/acme/widgets/pull/30",
                    "isDraft": false,
                    "headRefOid": "merged123"
                }]
            }
        }"#).unwrap();
        let prs = parse_pr_nodes(&json, "b0");
        assert_eq!(prs[0].state, PrState::Merged);
    }

    #[test]
    fn parse_pr_nodes_empty() {
        let json: serde_json::Value = serde_json::from_str(r#"{
            "b0": { "nodes": [] }
        }"#).unwrap();
        assert!(parse_pr_nodes(&json, "b0").is_empty());
    }

    #[test]
    fn parse_pr_nodes_missing_alias() {
        let json: serde_json::Value = serde_json::from_str(r#"{}"#).unwrap();
        assert!(parse_pr_nodes(&json, "b0").is_empty());
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

    #[test]
    fn is_ancestor_of_true_for_parent_commit() {
        let (dir, repo, sig, tree_id) = init_test_repo();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent_oid = repo
            .commit(Some("HEAD"), &sig, &sig, "first", &tree, &[])
            .unwrap();
        let parent_commit = repo.find_commit(parent_oid).unwrap();
        let child_oid = repo
            .commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent_commit])
            .unwrap();

        let path = dir.path().to_str().unwrap();
        assert!(is_ancestor_of(path, &parent_oid.to_string(), &child_oid.to_string()));
    }

    #[test]
    fn is_ancestor_of_false_for_unrelated_commit() {
        let (dir, repo, sig, tree_id) = init_test_repo();
        let tree = repo.find_tree(tree_id).unwrap();

        // Two independent root commits — neither is ancestor of the other
        let oid_a = repo
            .commit(Some("HEAD"), &sig, &sig, "branch-a", &tree, &[])
            .unwrap();
        repo.set_head_detached(oid_a).unwrap();
        let oid_b = repo
            .commit(None, &sig, &sig, "branch-b", &tree, &[])
            .unwrap();

        let path = dir.path().to_str().unwrap();
        assert!(!is_ancestor_of(path, &oid_a.to_string(), &oid_b.to_string()));
        assert!(!is_ancestor_of(path, &oid_b.to_string(), &oid_a.to_string()));
    }

    #[test]
    fn is_ancestor_of_false_for_bad_oid() {
        let (dir, _, _, _) = init_test_repo();
        let path = dir.path().to_str().unwrap();
        assert!(!is_ancestor_of(path, "not-a-sha", "also-not-a-sha"));
    }

    #[test]
    fn is_ancestor_of_same_commit_is_strict() {
        // git2::graph_descendant_of is strict — a commit is NOT its own descendant.
        // should_show_pr handles this with an explicit pr_oid == local_oid check.
        let (dir, repo, sig, tree_id) = init_test_repo();
        let tree = repo.find_tree(tree_id).unwrap();
        let oid = repo
            .commit(Some("HEAD"), &sig, &sig, "only", &tree, &[])
            .unwrap();
        let hex = oid.to_string();
        assert!(!is_ancestor_of(dir.path().to_str().unwrap(), &hex, &hex));
    }

    #[test]
    fn should_show_pr_merged_same_commit_shown() {
        // Most common case: local branch still at the PR's head after merge.
        let pr = test_pr(PrState::Merged, Some("same_sha"));
        assert!(should_show_pr(&pr, "same_sha", "/nonexistent"));
    }

    #[test]
    fn build_repo_pr_query_escapes_quotes_in_branch() {
        let query = build_repo_pr_query("acme", "wdg", &["feat/\"quoted\"".to_string()]);
        assert!(query.contains(r#"headRefName: "feat/\"quoted\"""#));
    }

    #[test]
    fn should_show_pr_open_always_matches() {
        let pr = test_pr(PrState::Open, Some("different_sha"));
        assert!(should_show_pr(&pr, "local_sha", "/nonexistent"));
    }

    #[test]
    fn should_show_pr_draft_always_matches() {
        let pr = test_pr(PrState::Draft, Some("different_sha"));
        assert!(should_show_pr(&pr, "local_sha", "/nonexistent"));
    }

    #[test]
    fn should_show_pr_closed_exact_sha_match() {
        let pr = test_pr(PrState::Closed, Some("abc123"));
        assert!(should_show_pr(&pr, "abc123", "/nonexistent"));
    }

    #[test]
    fn should_show_pr_closed_sha_mismatch_filtered() {
        let pr = test_pr(PrState::Closed, Some("abc123"));
        assert!(!should_show_pr(&pr, "def456", "/nonexistent"));
    }

    #[test]
    fn should_show_pr_closed_no_head_oid_filtered() {
        let pr = test_pr(PrState::Closed, None);
        assert!(!should_show_pr(&pr, "any_sha", "/nonexistent"));
    }

    #[test]
    fn should_show_pr_merged_no_head_oid_shown() {
        let pr = test_pr(PrState::Merged, None);
        assert!(should_show_pr(&pr, "any_sha", "/nonexistent"));
    }

    #[test]
    fn should_show_pr_merged_ancestor_shown() {
        let (dir, repo, sig, tree_id) = init_test_repo();
        let tree = repo.find_tree(tree_id).unwrap();
        let parent_oid = repo
            .commit(Some("HEAD"), &sig, &sig, "first", &tree, &[])
            .unwrap();
        let parent = repo.find_commit(parent_oid).unwrap();
        let child_oid = repo
            .commit(Some("HEAD"), &sig, &sig, "second", &tree, &[&parent])
            .unwrap();

        let pr = test_pr(PrState::Merged, Some(&parent_oid.to_string()));
        assert!(should_show_pr(
            &pr,
            &child_oid.to_string(),
            dir.path().to_str().unwrap()
        ));
    }

    #[test]
    fn should_show_pr_merged_not_ancestor_filtered() {
        let (dir, repo, sig, tree_id) = init_test_repo();
        let tree = repo.find_tree(tree_id).unwrap();
        let oid_a = repo
            .commit(Some("HEAD"), &sig, &sig, "a", &tree, &[])
            .unwrap();
        repo.set_head_detached(oid_a).unwrap();
        let oid_b = repo
            .commit(None, &sig, &sig, "b", &tree, &[])
            .unwrap();

        let pr = test_pr(PrState::Merged, Some(&oid_a.to_string()));
        assert!(!should_show_pr(
            &pr,
            &oid_b.to_string(),
            dir.path().to_str().unwrap()
        ));
    }
}
