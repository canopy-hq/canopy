# PR Status Badges in Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show PR status badges (Open/Draft/Merged/Closed) on branch and worktree rows in the sidebar, fetched from GitHub GraphQL API on a separate polling cadence that never blocks local git operations.

**Architecture:** A dedicated Rust command (`github_get_pr_statuses`) fetches PR data via GitHub GraphQL search API, batching multiple repos into aliased queries. A new `usePrPolling` React hook polls this on a 30s+ adaptive cadence, fully decoupled from the fast 3s local git polling. Badge rendering reuses the existing `Badge` component with new color variants.

**Tech Stack:** Rust (reqwest, serde_json, git2), TypeScript (React hooks, Tauri IPC), Tailwind CSS, tailwind-variants

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `apps/desktop/src-tauri/Cargo.toml` | (no changes needed — reqwest + serde_json already available) |
| Modify | `apps/desktop/src-tauri/src/github.rs` | OAuth scope fix, `PrState`/`PrInfo` types, search query builder, `github_get_pr_statuses` command |
| Modify | `apps/desktop/src-tauri/src/git.rs` | `parse_github_remote()` — extract owner/repo from origin URL |
| Modify | `apps/desktop/src-tauri/src/lib.rs` | Register new command |
| Modify | `apps/desktop/src/lib/github.ts` | `PrState`/`PrInfo` types, `getPrStatuses()` IPC wrapper |
| Create | `apps/desktop/src/lib/workspace-utils.ts` | Shared `getExpandedWorkspacePaths()` utility (DRY between polling hooks) |
| Create | `apps/desktop/src/hooks/usePrPolling.ts` | Dedicated PR polling hook with adaptive backoff |
| Modify | `apps/desktop/src/hooks/useWorkspacePolling.ts` | Use shared `getExpandedWorkspacePaths()` |
| Modify | `apps/desktop/src/components/ui/Badge.tsx` | Add `success` + `merged` color variants |
| Modify | `apps/desktop/src/components/WorkspaceTree.tsx` | `PrBadge` component, wire into `BranchRow`/`WorktreeRow`, call `usePrPolling` |
| Modify | `apps/desktop/src/lib/__tests__/github.test.ts` | Tests for `getPrStatuses` IPC wrapper |
| Create | `apps/desktop/src/lib/__tests__/workspace-utils.test.ts` | Tests for shared utility |
| Create | `apps/desktop/src/hooks/__tests__/usePrPolling.test.ts` | Tests for pure functions (`getPrInterval`, `prMapEqual`) |

---

### Task 1: Rust — `parse_github_remote` + tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/git.rs`

This function opens a git repo and extracts `(owner, repo)` from the `origin` remote URL. Handles HTTPS and SSH GitHub URLs, with or without `.git` suffix. Returns `None` for non-GitHub remotes.

- [ ] **Step 1: Write the tests**

Add these tests at the bottom of the existing `#[cfg(test)] mod tests` block in `git.rs`:

```rust
#[test]
fn parse_github_remote_https() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    repo.remote("origin", "https://github.com/nept/superagent").unwrap();
    let result = parse_github_remote(&tmp.path().to_string_lossy());
    assert_eq!(result, Some(("nept".to_string(), "superagent".to_string())));
}

#[test]
fn parse_github_remote_https_with_git_suffix() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    repo.remote("origin", "https://github.com/nept/superagent.git").unwrap();
    let result = parse_github_remote(&tmp.path().to_string_lossy());
    assert_eq!(result, Some(("nept".to_string(), "superagent".to_string())));
}

#[test]
fn parse_github_remote_ssh() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    repo.remote("origin", "git@github.com:nept/superagent.git").unwrap();
    let result = parse_github_remote(&tmp.path().to_string_lossy());
    assert_eq!(result, Some(("nept".to_string(), "superagent".to_string())));
}

#[test]
fn parse_github_remote_ssh_no_suffix() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    repo.remote("origin", "git@github.com:nept/superagent").unwrap();
    let result = parse_github_remote(&tmp.path().to_string_lossy());
    assert_eq!(result, Some(("nept".to_string(), "superagent".to_string())));
}

#[test]
fn parse_github_remote_non_github_host() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    repo.remote("origin", "https://gitlab.com/nept/superagent").unwrap();
    let result = parse_github_remote(&tmp.path().to_string_lossy());
    assert_eq!(result, None);
}

#[test]
fn parse_github_remote_no_origin() {
    let tmp = TempDir::new().unwrap();
    let _repo = init_repo_with_commit(tmp.path());
    let result = parse_github_remote(&tmp.path().to_string_lossy());
    assert_eq!(result, None);
}

#[test]
fn parse_github_remote_local_path() {
    let tmp = TempDir::new().unwrap();
    let repo = init_repo_with_commit(tmp.path());
    repo.remote("origin", "/some/local/path").unwrap();
    let result = parse_github_remote(&tmp.path().to_string_lossy());
    assert_eq!(result, None);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test parse_github_remote 2>&1`
Expected: compilation error — `parse_github_remote` not found.

- [ ] **Step 3: Implement `parse_github_remote`**

Add this public function in `git.rs`, after the existing `pub struct BranchDetail` block (around line 43):

```rust
/// Extract (owner, repo) from the `origin` remote URL if it's a GitHub URL.
/// Handles HTTPS (`https://github.com/owner/repo[.git]`) and SSH (`git@github.com:owner/repo[.git]`).
pub fn parse_github_remote(repo_path: &str) -> Option<(String, String)> {
    let repo = Repository::open(repo_path).ok()?;
    let remote = repo.find_remote("origin").ok()?;
    let url = remote.url()?;

    // Try HTTPS: https://github.com/{owner}/{repo}[.git]
    if let Some(path) = url.strip_prefix("https://github.com/") {
        return parse_owner_repo(path);
    }

    // Try SSH: git@github.com:{owner}/{repo}[.git]
    if let Some(path) = url.strip_prefix("git@github.com:") {
        return parse_owner_repo(path);
    }

    None
}

fn parse_owner_repo(path: &str) -> Option<(String, String)> {
    let path = path.strip_suffix(".git").unwrap_or(path);
    let mut parts = path.splitn(2, '/');
    let owner = parts.next()?.to_string();
    let repo = parts.next()?.to_string();
    if owner.is_empty() || repo.is_empty() || repo.contains('/') {
        return None;
    }
    Some((owner, repo))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test parse_github_remote 2>&1`
Expected: all 7 tests pass.

- [ ] **Step 5: Run clippy**

Run: `cd apps/desktop/src-tauri && cargo clippy 2>&1`
Expected: no warnings from our code.

- [ ] **Step 6: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src-tauri/src/git.rs
git commit -m "feat(git): add parse_github_remote to extract owner/repo from origin URL"
```

---

### Task 2: Rust — `PrState` enum, `PrInfo` struct, search query builder + tests

**Files:**
- Modify: `apps/desktop/src-tauri/src/github.rs`

- [ ] **Step 1: Write the tests for types and query builder**

Add at the bottom of the existing `#[cfg(test)] mod tests` block in `github.rs`:

```rust
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
    // Create enough branches to exceed the chunk limit
    let branches: Vec<String> = (0..30).map(|i| format!("feature/very-long-branch-name-{i:03}")).collect();
    let queries = build_search_queries("nept/superagent", &branches);
    assert!(queries.len() > 1, "Should split into multiple queries");
    // Every branch should appear in exactly one query
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

    // isDraft=true overrides OPEN → Draft
    assert_eq!(prs[1].branch, "feat/pr-badges");
    assert_eq!(prs[1].state, PrState::Draft);

    assert_eq!(prs[2].branch, "fix/sidebar");
    assert_eq!(prs[2].state, PrState::Merged);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop/src-tauri && cargo test -p superagent -- pr_state 2>&1`
Expected: compilation error — types not found.

- [ ] **Step 3: Implement the types and query builder**

Add these after the existing `GitHubConnection` struct (around line 55) in `github.rs`:

```rust
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
/// the ~256-char search query limit. Branch names are always quoted to handle
/// special characters (slashes, hashes, etc.).
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop/src-tauri && cargo test -p superagent -- pr_state build_search_queries parse_graphql_pr_response pr_info 2>&1`
Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src-tauri/src/github.rs
git commit -m "feat(github): add PrState/PrInfo types and search query builder"
```

---

### Task 3: Rust — `github_get_pr_statuses` Tauri command

**Files:**
- Modify: `apps/desktop/src-tauri/src/github.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

This is the main command. It:
1. Loads the GitHub token from keychain (returns `{}` if none)
2. Parses `origin` remote for each repo path → groups by `owner/repo`
3. Builds aliased GraphQL queries (multiple search aliases per HTTP call)
4. Executes with Semaphore(2) + single retry for transient errors
5. Maps results back to `HashMap<repo_path, Vec<PrInfo>>`

- [ ] **Step 1: Implement the command**

Add after the `parse_search_results` function in `github.rs`:

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Semaphore;

// ── PR Status command ────────────────────────────────────────────────

/// Max search aliases per single GraphQL HTTP request.
const MAX_ALIASES_PER_REQUEST: usize = 8;

/// Build one GraphQL query body containing multiple aliased search calls.
fn build_aliased_graphql(alias_queries: &[(String, String)]) -> String {
    let mut body = String::from("{ ");
    for (alias, search_query) in alias_queries {
        // Escape double quotes inside the search query for JSON embedding
        let escaped = search_query.replace('"', "\\\"");
        body.push_str(&format!(
            r#"{alias}: search(query: "{escaped}", type: ISSUE, first: 100) {{ edges {{ node {{ ... on PullRequest {{ number state headRefName url isDraft }} }} }} }} "#
        ));
    }
    body.push('}');
    body
}

/// Execute a single GraphQL request. Returns the parsed JSON response.
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

    resp.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("GraphQL parse error: {e}"))
}

/// Execute GraphQL with a single retry for transient errors (rate limit, network).
async fn execute_graphql_with_retry(
    client: &reqwest::Client,
    token: &str,
    query: &str,
) -> Result<serde_json::Value, String> {
    match execute_graphql(client, token, query).await {
        Ok(v) => Ok(v),
        Err(e) => {
            // Retry once for transient errors
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
) -> Result<HashMap<String, Vec<PrInfo>>, String> {
    // Graceful degradation: no token = no badges
    let token = match load_token()? {
        Some(t) => t,
        None => return Ok(HashMap::new()),
    };

    // Phase 1: Parse remotes (blocking git2 ops) → group by owner/repo
    // Each entry: (owner_repo, Vec<(repo_path, Vec<branch_name>)>)
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
                // Also collect branch names for this repo
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

    for handle in handles {
        match handle.await {
            Ok(Ok((path, (Some((owner, repo)), branches)))) => {
                let key = format!("{owner}/{repo}");
                owner_repo_map
                    .entry(key)
                    .or_default()
                    .push((path, branches));
            }
            Ok(Ok(_)) => {} // Non-GitHub remote, skip
            Ok(Err(e)) => eprintln!("github_get_pr_statuses: remote parse failed: {e}"),
            Err(e) => eprintln!("github_get_pr_statuses: task panicked: {e}"),
        }
    }

    if owner_repo_map.is_empty() {
        return Ok(HashMap::new());
    }

    // Phase 2: Build search queries grouped by owner/repo, then batch into aliased GraphQL calls
    // Collect: (alias, search_query, owner_repo) for mapping results back
    let mut all_aliases: Vec<(String, String, String)> = Vec::new(); // (alias, query, owner_repo)

    for (owner_repo, repo_entries) in &owner_repo_map {
        // Collect all unique branch names across repo_paths for this owner/repo
        let mut all_branches: Vec<String> = repo_entries
            .iter()
            .flat_map(|(_, branches)| branches.iter().cloned())
            .collect();
        all_branches.sort();
        all_branches.dedup();

        let queries = build_search_queries(owner_repo, &all_branches);
        for query in queries {
            let alias = format!("s{}", all_aliases.len());
            all_aliases.push((alias, query, owner_repo.clone()));
        }
    }

    // Phase 3: Execute GraphQL requests (batch aliases, max MAX_ALIASES_PER_REQUEST per HTTP call)
    let gql_sem = Arc::new(Semaphore::new(2));
    let mut gql_handles = Vec::new();

    for chunk in all_aliases.chunks(MAX_ALIASES_PER_REQUEST) {
        let alias_queries: Vec<(String, String)> = chunk
            .iter()
            .map(|(alias, query, _)| (alias.clone(), query.clone()))
            .collect();
        let aliases_in_chunk: Vec<(String, String)> = chunk
            .iter()
            .map(|(alias, _, owner_repo)| (alias.clone(), owner_repo.clone()))
            .collect();
        let client = http.0.clone();
        let token = token.clone();
        let sem = gql_sem.clone();

        gql_handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let query = build_aliased_graphql(&alias_queries);
            let response = execute_graphql_with_retry(&client, &token, &query).await?;

            let mut prs_by_owner_repo: HashMap<String, Vec<PrInfo>> = HashMap::new();
            for (alias, owner_repo) in &aliases_in_chunk {
                let prs = parse_search_results(&response, alias);
                prs_by_owner_repo
                    .entry(owner_repo.clone())
                    .or_default()
                    .extend(prs);
            }
            Ok::<_, String>(prs_by_owner_repo)
        }));
    }

    // Phase 4: Collect results and map back to repo_paths
    let mut prs_by_owner_repo: HashMap<String, Vec<PrInfo>> = HashMap::new();
    for handle in gql_handles {
        match handle.await {
            Ok(Ok(batch)) => {
                for (key, prs) in batch {
                    prs_by_owner_repo.entry(key).or_default().extend(prs);
                }
            }
            Ok(Err(e)) => eprintln!("github_get_pr_statuses: GraphQL request failed: {e}"),
            Err(e) => eprintln!("github_get_pr_statuses: task panicked: {e}"),
        }
    }

    // Map owner/repo PRs back to individual repo_paths
    let mut result: HashMap<String, Vec<PrInfo>> = HashMap::new();
    for (owner_repo, repo_entries) in &owner_repo_map {
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

    Ok(result)
}
```

Note: you'll need to add `use std::collections::HashMap;` and `use std::sync::Arc; use tokio::sync::Semaphore;` at the top of `github.rs` if not already there.

- [ ] **Step 2: Register the command in `lib.rs`**

In `apps/desktop/src-tauri/src/lib.rs`, add `github::github_get_pr_statuses` to the `invoke_handler` list (after `github::github_disconnect`):

```rust
github::github_disconnect,
github::github_get_pr_statuses,
```

- [ ] **Step 3: Fix the OAuth scope**

In `github.rs`, line 134, change:
```rust
.form(&[("client_id", cid.as_str()), ("scope", "repo:status read:user")])
```
to:
```rust
.form(&[("client_id", cid.as_str()), ("scope", "repo read:user")])
```

- [ ] **Step 4: Run all Rust tests**

Run: `cd apps/desktop/src-tauri && cargo test 2>&1`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Run clippy**

Run: `cd apps/desktop/src-tauri && cargo clippy 2>&1`
Expected: no warnings.

- [ ] **Step 6: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src-tauri/src/github.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(github): add github_get_pr_statuses command with GraphQL batching

Batched search queries with aliased GraphQL, single retry for transient errors,
graceful degradation when no GitHub token. Also upgrades OAuth scope to 'repo'."
```

---

### Task 4: Frontend — shared `getExpandedWorkspacePaths` utility + tests

**Files:**
- Create: `apps/desktop/src/lib/workspace-utils.ts`
- Create: `apps/desktop/src/lib/__tests__/workspace-utils.test.ts`
- Modify: `apps/desktop/src/hooks/useWorkspacePolling.ts`

Extract the workspace filtering logic shared between both polling hooks.

- [ ] **Step 1: Write the test**

Create `apps/desktop/src/lib/__tests__/workspace-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

import { getExpandedWorkspacePaths } from '../workspace-utils';

import type { Workspace } from '@superagent/db';

function makeWs(id: string, path: string, expanded: boolean): Workspace {
  return {
    id,
    path,
    name: id,
    expanded,
    position: 0,
    branches: [],
    worktrees: [],
  } as Workspace;
}

describe('getExpandedWorkspacePaths', () => {
  it('returns only expanded workspaces', () => {
    const workspaces = [
      makeWs('ws1', '/path/1', true),
      makeWs('ws2', '/path/2', false),
      makeWs('ws3', '/path/3', true),
    ];
    const result = getExpandedWorkspacePaths(workspaces);
    expect(result.paths).toEqual(['/path/1', '/path/3']);
    expect(result.expandedIds.size).toBe(2);
    expect(result.expandedIds.has('ws1')).toBe(true);
    expect(result.expandedIds.has('ws3')).toBe(true);
  });

  it('maps paths to IDs correctly', () => {
    const workspaces = [makeWs('ws1', '/path/1', true)];
    const result = getExpandedWorkspacePaths(workspaces);
    expect(result.pathToId.get('/path/1')).toBe('ws1');
  });

  it('returns empty for no expanded workspaces', () => {
    const workspaces = [makeWs('ws1', '/path/1', false)];
    const result = getExpandedWorkspacePaths(workspaces);
    expect(result.paths).toEqual([]);
    expect(result.pathToId.size).toBe(0);
    expect(result.expandedIds.size).toBe(0);
  });

  it('returns empty for empty input', () => {
    const result = getExpandedWorkspacePaths([]);
    expect(result.paths).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/lib/__tests__/workspace-utils.test.ts 2>&1`
Expected: module not found.

- [ ] **Step 3: Implement the utility**

Create `apps/desktop/src/lib/workspace-utils.ts`:

```typescript
import type { Workspace } from '@superagent/db';

export interface ExpandedWorkspaceInfo {
  paths: string[];
  pathToId: Map<string, string>;
  expandedIds: Set<string>;
}

export function getExpandedWorkspacePaths(workspaces: Workspace[]): ExpandedWorkspaceInfo {
  const expanded = workspaces.filter((ws) => ws.expanded);
  return {
    paths: expanded.map((ws) => ws.path),
    pathToId: new Map(expanded.map((ws) => [ws.path, ws.id])),
    expandedIds: new Set(expanded.map((ws) => ws.id)),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/lib/__tests__/workspace-utils.test.ts 2>&1`
Expected: all 4 tests pass.

- [ ] **Step 5: Refactor `useWorkspacePolling` to use the shared utility**

In `apps/desktop/src/hooks/useWorkspacePolling.ts`, replace the inline filtering at lines 113-116:

Replace:
```typescript
const expandedWs = current.filter((ws) => ws.expanded);
const pathToId = new Map(expandedWs.map((ws) => [ws.path, ws.id]));
const paths = expandedWs.map((ws) => ws.path);
```

With:
```typescript
import { getExpandedWorkspacePaths } from '../lib/workspace-utils';
// ... (add to the imports at the top)

const { paths, pathToId, expandedIds: expandedIdsFromPoll } = getExpandedWorkspacePaths(current);
```

And replace line 122:
```typescript
const expandedIds = new Set(expandedWs.map((ws) => ws.id));
```

With:
```typescript
const expandedIds = expandedIdsFromPoll;
```

- [ ] **Step 6: Run existing workspace polling tests**

Run: `cd apps/desktop && npx vitest run src/hooks/__tests__/useWorkspacePolling.test.ts 2>&1`
Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src/lib/workspace-utils.ts apps/desktop/src/lib/__tests__/workspace-utils.test.ts apps/desktop/src/hooks/useWorkspacePolling.ts
git commit -m "refactor: extract getExpandedWorkspacePaths shared utility"
```

---

### Task 5: Frontend — `PrInfo` type + `getPrStatuses` IPC wrapper + tests

**Files:**
- Modify: `apps/desktop/src/lib/github.ts`
- Modify: `apps/desktop/src/lib/__tests__/github.test.ts`

- [ ] **Step 1: Write the test**

Add to the existing `describe('github', ...)` block in `apps/desktop/src/lib/__tests__/github.test.ts`:

```typescript
it('getPrStatuses calls invoke with repo paths', async () => {
  const response = {
    '/path/to/repo': [
      {
        branch: 'feat/test',
        number: 42,
        state: 'OPEN',
        url: 'https://github.com/nept/superagent/pull/42',
      },
    ],
  };
  mockInvoke.mockResolvedValue(response);

  const { getPrStatuses } = await import('../github');
  const result = await getPrStatuses(['/path/to/repo']);
  expect(mockInvoke).toHaveBeenCalledWith('github_get_pr_statuses', {
    repoPaths: ['/path/to/repo'],
  });
  expect(result).toEqual(response);
});
```

Also add `getPrStatuses` to the import at the top of the file:
```typescript
import { startDeviceFlow, pollToken, getConnection, cancelPoll, disconnect, getPrStatuses } from '../github';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/desktop && npx vitest run src/lib/__tests__/github.test.ts 2>&1`
Expected: `getPrStatuses` not exported.

- [ ] **Step 3: Implement the types and wrapper**

Add to the bottom of `apps/desktop/src/lib/github.ts`:

```typescript
// ── PR Status types ──────────────────────────────────────────────────

export type PrState = 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED';

export interface PrInfo {
  branch: string;
  number: number;
  state: PrState;
  url: string;
}

export function getPrStatuses(
  repoPaths: string[],
): Promise<Record<string, PrInfo[]>> {
  return invoke<Record<string, PrInfo[]>>('github_get_pr_statuses', { repoPaths });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/desktop && npx vitest run src/lib/__tests__/github.test.ts 2>&1`
Expected: all tests pass (existing + new).

- [ ] **Step 5: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src/lib/github.ts apps/desktop/src/lib/__tests__/github.test.ts
git commit -m "feat(github): add PrInfo type and getPrStatuses IPC wrapper"
```

---

### Task 6: Frontend — `usePrPolling` hook + tests

**Files:**
- Create: `apps/desktop/src/hooks/usePrPolling.ts`
- Create: `apps/desktop/src/hooks/__tests__/usePrPolling.test.ts`

The hook follows the exact same ref-based timer pattern as `useWorkspacePolling` but with a 30s base interval and its own adaptive backoff.

- [ ] **Step 1: Write the pure function tests**

Create `apps/desktop/src/hooks/__tests__/usePrPolling.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

import { getPrInterval, prMapEqual } from '../usePrPolling';

import type { PrInfo } from '../../lib/github';

function makePr(branch: string, number: number, state: 'OPEN' | 'DRAFT' | 'MERGED' | 'CLOSED'): PrInfo {
  return { branch, number, state, url: `https://github.com/nept/superagent/pull/${number}` };
}

describe('getPrInterval', () => {
  it('returns 30s for 0 unchanged polls', () => {
    expect(getPrInterval(0)).toBe(30_000);
  });

  it('returns 30s for 4 unchanged polls', () => {
    expect(getPrInterval(4)).toBe(30_000);
  });

  it('returns 60s at 5 unchanged polls', () => {
    expect(getPrInterval(5)).toBe(60_000);
  });

  it('returns 60s at 9 unchanged polls', () => {
    expect(getPrInterval(9)).toBe(60_000);
  });

  it('returns 120s at 10 unchanged polls', () => {
    expect(getPrInterval(10)).toBe(120_000);
  });

  it('returns 120s at 20 unchanged polls', () => {
    expect(getPrInterval(20)).toBe(120_000);
  });
});

describe('prMapEqual', () => {
  it('returns true for identical maps', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 1, 'OPEN') } };
    expect(prMapEqual(a, b)).toBe(true);
  });

  it('returns true for both empty', () => {
    expect(prMapEqual({}, {})).toBe(true);
  });

  it('returns false when workspace count differs', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = {};
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when branch count differs', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 1, 'OPEN'), feat: makePr('feat', 2, 'DRAFT') } };
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when PR number changes', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 2, 'OPEN') } };
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when PR state changes', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws1: { main: makePr('main', 1, 'MERGED') } };
    expect(prMapEqual(a, b)).toBe(false);
  });

  it('returns false when workspace key differs', () => {
    const a = { ws1: { main: makePr('main', 1, 'OPEN') } };
    const b = { ws2: { main: makePr('main', 1, 'OPEN') } };
    expect(prMapEqual(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/hooks/__tests__/usePrPolling.test.ts 2>&1`
Expected: module not found.

- [ ] **Step 3: Implement `usePrPolling`**

Create `apps/desktop/src/hooks/usePrPolling.ts`:

```typescript
import { useState, useRef, useEffect, useMemo } from 'react';

import { getPrStatuses } from '../lib/github';
import { getExpandedWorkspacePaths } from '../lib/workspace-utils';

import type { PrInfo } from '../lib/github';
import type { Workspace } from '@superagent/db';

const PR_POLL_MS = 30_000;

export type PrMap = Record<string, Record<string, PrInfo>>;

export function getPrInterval(noChangeCount: number): number {
  if (noChangeCount >= 10) return 120_000;
  if (noChangeCount >= 5) return 60_000;
  return PR_POLL_MS;
}

/** Shallow-compare two nested PR maps (wsId → branchName → PrInfo). */
export function prMapEqual(a: PrMap, b: PrMap): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const wsId of bKeys) {
    const aWs = a[wsId];
    const bWs = b[wsId];
    if (!aWs) return false;
    const aK = Object.keys(aWs);
    const bK = Object.keys(bWs);
    if (aK.length !== bK.length) return false;
    for (const k of bK) {
      if (aWs[k]?.number !== bWs[k]?.number || aWs[k]?.state !== bWs[k]?.state) return false;
    }
  }
  return true;
}

/**
 * Dedicated PR status polling hook. Fully decoupled from local git polling.
 * Polls GitHub API on a 30s+ adaptive cadence. Never blocks local operations.
 */
export function usePrPolling(
  workspaces: Workspace[],
  enabled: boolean,
  githubConnected: boolean,
): PrMap {
  const [prMap, setPrMap] = useState<PrMap>({});
  const workspacesRef = useRef(workspaces);
  const noChangeCountRef = useRef(0);
  const prevPrMapRef = useRef(prMap);
  prevPrMapRef.current = prMap;

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  const workspaceKey = useMemo(
    () => workspaces.map((ws) => `${ws.id}:${ws.expanded ? 1 : 0}`).join(','),
    [workspaces],
  );

  useEffect(() => {
    if (!enabled || !githubConnected) return;
    noChangeCountRef.current = 0;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    function poll() {
      const current = workspacesRef.current;
      const { paths, pathToId, expandedIds } = getExpandedWorkspacePaths(current);

      if (paths.length === 0) {
        timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        return;
      }

      getPrStatuses(paths)
        .then((result) => {
          if (cancelled) return;

          // Convert Vec<PrInfo> → Record<branchName, PrInfo> keyed by wsId
          const nextPrMap: PrMap = {};
          for (const [path, prs] of Object.entries(result)) {
            const id = pathToId.get(path);
            if (!id) continue;
            const byBranch: Record<string, PrInfo> = {};
            for (const pr of prs) {
              byBranch[pr.branch] = pr;
            }
            nextPrMap[id] = byBranch;
          }

          // Merge: carry forward stale data for collapsed workspaces
          const prev = prevPrMapRef.current;
          const merged: PrMap = {};
          for (const wsId in prev) {
            if (!expandedIds.has(wsId)) merged[wsId] = prev[wsId];
          }
          for (const wsId in nextPrMap) {
            merged[wsId] = nextPrMap[wsId];
          }

          if (!prMapEqual(prev, merged)) {
            noChangeCountRef.current = 0;
            setPrMap(merged);
          } else {
            noChangeCountRef.current += 1;
          }

          timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        })
        .catch(() => {
          if (!cancelled) timer = setTimeout(poll, getPrInterval(noChangeCountRef.current));
        });
    }

    poll(); // Fire immediately on mount
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [workspaceKey, enabled, githubConnected]);

  return prMap;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/desktop && npx vitest run src/hooks/__tests__/usePrPolling.test.ts 2>&1`
Expected: all 13 tests pass.

- [ ] **Step 5: Run all frontend tests**

Run: `bun --filter desktop run test 2>&1`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src/hooks/usePrPolling.ts apps/desktop/src/hooks/__tests__/usePrPolling.test.ts
git commit -m "feat(hooks): add usePrPolling hook with adaptive backoff"
```

---

### Task 7: Frontend — Badge color variants

**Files:**
- Modify: `apps/desktop/src/components/ui/Badge.tsx`

- [ ] **Step 1: Add `success` and `merged` color variants**

In `apps/desktop/src/components/ui/Badge.tsx`, add two entries to the `color` variants object (after `error`):

```typescript
color: {
  neutral: 'bg-white/[0.06] text-text-muted',
  accent: 'bg-accent/10 text-accent',
  warning: 'bg-amber-600/10 text-amber-600',
  error: 'bg-destructive/[0.08] text-destructive',
  success: 'bg-emerald-500/10 text-emerald-500',
  merged: 'bg-purple-500/10 text-purple-500',
},
```

- [ ] **Step 2: Run lint to verify no issues**

Run: `bun run lint 2>&1`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src/components/ui/Badge.tsx
git commit -m "feat(ui): add success and merged color variants to Badge"
```

---

### Task 8: Frontend — `PrBadge` component + wire into sidebar rows

**Files:**
- Modify: `apps/desktop/src/components/WorkspaceTree.tsx`

This is the final wiring task. We add the `PrBadge` memo component, add `prInfo` props to `BranchRow` and `WorktreeRow`, call `usePrPolling` in `WorkspaceTree`, and thread the data down.

- [ ] **Step 1: Add imports**

At the top of `WorkspaceTree.tsx`, add these imports:

```typescript
import { useSettings } from '../hooks/useCollections';
// (useSettings is already importable from the existing import, just add it to the destructure)
```

Change line 10:
```typescript
import { useWorkspaces, useAgents, useTabs, useUiState } from '../hooks/useCollections';
```
to:
```typescript
import { useWorkspaces, useAgents, useTabs, useUiState, useSettings } from '../hooks/useCollections';
```

Add new imports:
```typescript
import { usePrPolling } from '../hooks/usePrPolling';
import { getSetting } from '@superagent/db';
import { GITHUB_CONNECTION_KEY } from '../lib/github';
import { Badge } from './ui';

import type { PrInfo } from '../lib/github';
```

- [ ] **Step 2: Add `PrBadge` component**

Add after the `DiffPill` component (after line 49):

```typescript
const PrBadge = memo(function PrBadge({ pr }: { pr: PrInfo }) {
  const colorMap = {
    OPEN: 'success',
    DRAFT: 'neutral',
    MERGED: 'merged',
    CLOSED: 'neutral',
  } as const;
  const labelMap = {
    OPEN: 'Open',
    DRAFT: 'Draft',
    MERGED: 'Merged',
    CLOSED: 'Closed',
  } as const;
  return (
    <Badge size="sm" color={colorMap[pr.state]}>
      #{pr.number} {labelMap[pr.state]}
    </Badge>
  );
});
```

- [ ] **Step 3: Add `prInfo` prop to `BranchRow`**

Update the `BranchRow` props type (around line 72-79) to include `prInfo`:

```typescript
function BranchRow({
  branch,
  agentStatus,
  diffStat,
  prInfo,
}: {
  branch: BranchInfo;
  agentStatus?: DotStatus;
  diffStat?: DiffStat;
  prInfo?: PrInfo;
}) {
```

Add `<PrBadge>` after the `<DiffPill>` in the flex row (after line 96):

```typescript
{diffStat && <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />}
{prInfo && <PrBadge pr={prInfo} />}
```

Update the memo comparator (around line 104-109) to include `prInfo`:

```typescript
(prev, next) =>
  prev.branch.name === next.branch.name &&
  prev.branch.is_head === next.branch.is_head &&
  prev.agentStatus === next.agentStatus &&
  prev.diffStat?.additions === next.diffStat?.additions &&
  prev.diffStat?.deletions === next.diffStat?.deletions &&
  prev.prInfo?.number === next.prInfo?.number &&
  prev.prInfo?.state === next.prInfo?.state,
```

- [ ] **Step 4: Add `prInfo` prop to `WorktreeRow`**

Update the `WorktreeRow` props type (around line 113-122) to include `prInfo`:

```typescript
function WorktreeRow({
  worktree,
  workspaceId,
  agentStatus,
  diffStat,
  prInfo,
}: {
  worktree: WorktreeInfo & { label?: string };
  workspaceId: string;
  agentStatus?: DotStatus;
  diffStat?: DiffStat;
  prInfo?: PrInfo;
}) {
```

Add `<PrBadge>` after the `<DiffPill>` in the flex row (after line 172):

```typescript
{diffStat && <DiffPill additions={diffStat.additions} deletions={diffStat.deletions} />}
{prInfo && <PrBadge pr={prInfo} />}
```

Update the memo comparator (around line 180-187) to include `prInfo`:

```typescript
(prev, next) =>
  prev.worktree.name === next.worktree.name &&
  prev.worktree.branch === next.worktree.branch &&
  prev.worktree.label === next.worktree.label &&
  prev.workspaceId === next.workspaceId &&
  prev.agentStatus === next.agentStatus &&
  prev.diffStat?.additions === next.diffStat?.additions &&
  prev.diffStat?.deletions === next.diffStat?.deletions &&
  prev.prInfo?.number === next.prInfo?.number &&
  prev.prInfo?.state === next.prInfo?.state,
```

- [ ] **Step 5: Call `usePrPolling` in `WorkspaceTree`**

In the `WorkspaceTree` function (around line 351-363), add:

```typescript
export function WorkspaceTree() {
  const workspaces = useWorkspaces();
  const settings = useSettings();
  const { selectedItemId, sidebarVisible } = useUiState();
  // ... existing state ...
  const agentMap = useWorkspaceAgentMap();
  const pageVisible = usePageVisible();
  const diffStatsMap = useWorkspacePolling(workspaces, sidebarVisible && pageVisible);

  const githubConnected = getSetting(settings, GITHUB_CONNECTION_KEY, null) !== null;
  const prMap = usePrPolling(workspaces, sidebarVisible && pageVisible, githubConnected);
```

- [ ] **Step 6: Add `prMap` to `RepoTreeItem` props and threading**

Update the `RepoTreeItem` props type to include `prStatuses`:

```typescript
function RepoTreeItem({
  ws,
  agentMap,
  diffStats,
  prStatuses,
  setModalWorkspace,
  onRequestClose,
  onRequestRemoveWt,
  selectedItemId,
  hasSeparator,
}: {
  ws: Workspace;
  agentMap: Record<string, DotStatus>;
  diffStats?: Record<string, DiffStat>;
  prStatuses?: Record<string, PrInfo>;
  setModalWorkspace: (ws: Workspace) => void;
  onRequestClose: (ws: Workspace) => void;
  onRequestRemoveWt: (name: string) => void;
  selectedItemId: string | null;
  hasSeparator: boolean;
}) {
```

In the `WorkspaceTree` render, pass `prStatuses` to `RepoTreeItem` (around line 413):

```typescript
<RepoTreeItem
  key={ws.id}
  ws={ws}
  agentMap={agentMap}
  diffStats={diffStatsMap[ws.id]}
  prStatuses={prMap[ws.id]}
  setModalWorkspace={setModalWorkspace}
  // ... rest unchanged
```

In `RepoTreeItem`, pass `prInfo` to `BranchRow` (around line 616-620):

```typescript
<BranchRow
  branch={b}
  agentStatus={agentMap[`${ws.id}-branch-${b.name}`]}
  diffStat={diffStats?.[b.name]}
  prInfo={prStatuses?.[b.name]}
/>
```

And to `WorktreeRow` (around line 640-644):

```typescript
<WorktreeRow
  worktree={wt}
  workspaceId={ws.id}
  agentStatus={agentMap[`${ws.id}-wt-${wt.name}`]}
  diffStat={diffStats?.[wt.branch]}
  prInfo={prStatuses?.[wt.branch]}
/>
```

- [ ] **Step 7: Run all frontend tests**

Run: `bun --filter desktop run test 2>&1`
Expected: all tests pass.

- [ ] **Step 8: Run lint**

Run: `bun run lint 2>&1`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
cd ~/Workspace/perso/superagent.feat-60-pr-status-badges-sidebar
git add apps/desktop/src/components/WorkspaceTree.tsx
git commit -m "feat(sidebar): add PR status badges on branch and worktree rows

Shows Open (green), Draft (gray), Merged (purple), Closed (gray) badges
next to diff stats. Fetched via dedicated usePrPolling hook on 30s+ cadence,
fully decoupled from local git polling."
```

---

### Task 9: Final verification

- [ ] **Step 1: Run all Rust tests**

Run: `cd apps/desktop/src-tauri && cargo test 2>&1`
Expected: all pass.

- [ ] **Step 2: Run clippy**

Run: `cd apps/desktop/src-tauri && cargo clippy 2>&1`
Expected: no warnings.

- [ ] **Step 3: Run all frontend tests**

Run: `bun --filter desktop run test 2>&1`
Expected: all pass.

- [ ] **Step 4: Run lint**

Run: `bun run lint 2>&1`
Expected: no errors.

- [ ] **Step 5: Visual verification**

Run: `bun run desktop:dev`
Expected:
- Sidebar shows PR badges (green "Open", purple "Merged", gray "Draft"/"Closed") next to diff stats
- Badges appear within ~30s of app launch (immediate first poll)
- Sidebar interactions (expand/collapse, selection) remain snappy — no lag from PR fetching
- With GitHub disconnected: no badges, no errors, no console spam
