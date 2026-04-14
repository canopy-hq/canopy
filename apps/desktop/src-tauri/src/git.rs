use git2::{BranchType, FetchPrune, Repository, WorktreeAddOptions, WorktreePruneOptions};
use serde::Serialize;
use tauri::Emitter;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;
use tokio::sync::Semaphore;

// ---------------------------------------------------------------------------
// Poll cache — skip full recomputation when nothing changed
// ---------------------------------------------------------------------------

#[derive(Clone, PartialEq)]
struct PollFingerprint {
    head_oid: String,
    index_mtime: SystemTime,
    worktree_heads: Vec<(String, String)>,
}

struct CachedPoll {
    fingerprint: PollFingerprint,
    state: ProjectPollState,
}

static POLL_CACHE: LazyLock<Mutex<HashMap<String, CachedPoll>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn invalidate_poll_cache(repo_path: &str) {
    if let Ok(mut cache) = POLL_CACHE.lock() {
        cache.remove(repo_path);
    }
}

/// Run a blocking git mutation via `spawn_blocking`, then invalidate the poll
/// cache for the given repo.  Extracts the repeated
/// `clone → spawn_blocking → invalidate` pattern used by all mutation commands.
async fn mutate_and_invalidate<T, F>(cache_key: String, f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    let result = tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?;
    invalidate_poll_cache(&cache_key);
    result
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CloneProgressPayload {
    pub project_id: String,
    /// "receiving" | "resolving" | "checkout"
    pub phase: String,
    pub step: usize,
    pub total: usize,
    pub bytes: usize,
}

/// Sanitize a worktree name for use as a git admin directory.
/// git2 stores worktree metadata under `.git/worktrees/{name}/` and uses
/// `mkdir` (not `mkdir -p`), so slashes in the name cause "No such file
/// or directory" errors.
fn sanitize_worktree_name(name: &str) -> String {
    name.replace('/', "-")
}

#[derive(Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Serialize, Clone, Debug)]
pub struct WorktreeInfo {
    pub name: String,
    pub path: String,
    pub branch: String,
}

#[derive(Serialize, Clone)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub branches: Vec<BranchInfo>,
    pub worktrees: Vec<WorktreeInfo>,
}

#[derive(Serialize, Clone)]
pub struct DiffStat {
    pub additions: usize,
    pub deletions: usize,
}

#[derive(Serialize, Clone)]
pub struct BranchDetail {
    pub name: String,
    pub is_head: bool,
    pub is_local: bool,
    pub is_in_worktree: bool,
}

/// Extract (owner, repo) from the `origin` remote URL if it's a GitHub URL.
pub fn parse_github_remote(repo_path: &str) -> Option<(String, String)> {
    let repo = Repository::open(repo_path).ok()?;
    let remote = repo.find_remote("origin").ok()?;
    let url = remote.url()?;

    if let Some(path) = url.strip_prefix("https://github.com/") {
        return parse_owner_repo(path);
    }
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

fn enumerate_branches(repo: &Repository, lightweight: bool) -> Result<Vec<BranchInfo>, String> {
    let mut branches = Vec::new();
    for branch_result in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?
    {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("(invalid utf8)")
            .to_string();
        let is_head = branch.is_head();

        let (ahead, behind) = if lightweight {
            (0, 0)
        } else {
            match branch.upstream() {
                Ok(upstream) => {
                    let local_oid = branch.get().target().unwrap();
                    let upstream_oid = upstream.get().target().unwrap();
                    repo.graph_ahead_behind(local_oid, upstream_oid)
                        .unwrap_or((0, 0))
                }
                Err(_) => (0, 0), // No upstream tracking
            }
        };

        branches.push(BranchInfo {
            name,
            is_head,
            ahead,
            behind,
        });
    }
    Ok(branches)
}

/// Resolve which branch a worktree belongs to.
///
/// Prefers the worktree admin name when a matching local branch exists — this
/// survives `git checkout <other>` inside the worktree (e.g. after a merge)
/// and keeps the worktree identity stable.  Falls back to HEAD for worktrees
/// whose admin name was sanitized (slashes → dashes) and therefore doesn't
/// match the branch name directly.
pub fn resolve_worktree_branch(wt_name: &str, wt_path: &Path, repo: &Repository) -> Option<String> {
    // 1. If a local branch matching the worktree name exists, prefer it.
    if let Ok(b) = repo.find_branch(wt_name, BranchType::Local) {
        if let Some(name) = b.name().ok().flatten() {
            return Some(name.to_string());
        }
    }
    // 2. Read HEAD directly from the worktree gitdir (avoids Repository::open).
    let head_path = repo.path().join("worktrees").join(wt_name).join("HEAD");
    if let Ok(content) = std::fs::read_to_string(&head_path) {
        let content = content.trim();
        if let Some(refname) = content.strip_prefix("ref: refs/heads/") {
            return Some(refname.to_string());
        }
        // Detached HEAD (raw OID) — no branch name to resolve.
        return None;
    }
    // 3. Last resort: open the worktree as a Repository (unusual layouts without
    //    a .git/worktrees/<name>/HEAD admin file).
    let wt_repo = Repository::open(wt_path).ok()?;
    let head = wt_repo.head().ok()?;
    if head.is_branch() {
        Some(head.shorthand()?.to_string())
    } else {
        None
    }
}

fn enumerate_worktrees(repo: &Repository) -> Result<Vec<WorktreeInfo>, String> {
    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut worktrees = Vec::new();
    for name in wt_names.iter() {
        let name = name.ok_or("invalid worktree name")?;
        match repo.find_worktree(name) {
            Ok(wt) => {
                if wt.validate().is_ok() {
                    let wt_path = wt.path().to_string_lossy().to_string();
                    let branch = resolve_worktree_branch(name, wt.path(), repo)
                        .unwrap_or_else(|| name.to_string());
                    worktrees.push(WorktreeInfo {
                        name: name.to_string(),
                        path: wt_path,
                        branch,
                    });
                }
            }
            Err(_) => continue,
        }
    }
    Ok(worktrees)
}

#[tauri::command]
pub async fn import_repo(path: String) -> Result<RepoInfo, String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;
        let name = Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| path.clone());
        let all_branches = enumerate_branches(&repo, true)?;
        let head_only: Vec<BranchInfo> = all_branches.into_iter().filter(|b| b.is_head).collect();
        Ok(RepoInfo {
            path,
            name,
            branches: head_only,
            worktrees: Vec::new(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
        enumerate_branches(&repo, false)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
        enumerate_worktrees(&repo)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn list_all_branches_sync(repo_path: String) -> Result<Vec<BranchDetail>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // Collect worktree branch names for cross-reference
    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut wt_branch_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for wt_name in wt_names.iter() {
        let wt_name = wt_name.ok_or("invalid worktree name")?;
        if let Ok(wt) = repo.find_worktree(wt_name) {
            if wt.validate().is_ok() {
                if let Some(branch) = resolve_worktree_branch(wt_name, wt.path(), &repo) {
                    wt_branch_names.insert(branch);
                }
            }
        }
    }

    let mut details = Vec::new();

    // Local branches
    for branch_result in repo.branches(Some(BranchType::Local)).map_err(|e| e.to_string())? {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch.name().map_err(|e| e.to_string())?
            .unwrap_or("(invalid utf8)").to_string();
        let is_head = branch.is_head();
        let is_in_worktree = wt_branch_names.contains(&name);

        details.push(BranchDetail {
            name,
            is_head,
            is_local: true,
            is_in_worktree,
        });
    }

    // Remote branches (origin only, skip if already local)
    let local_names: std::collections::HashSet<String> = details.iter().map(|d| d.name.clone()).collect();
    for branch_result in repo.branches(Some(BranchType::Remote)).map_err(|e| e.to_string())? {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let full_name = branch.name().map_err(|e| e.to_string())?
            .unwrap_or("(invalid utf8)").to_string();
        let short_name = full_name.strip_prefix("origin/").unwrap_or(&full_name).to_string();
        if short_name == "HEAD" || local_names.contains(&short_name) {
            continue;
        }
        details.push(BranchDetail {
            name: short_name,
            is_head: false,
            is_local: false,
            is_in_worktree: false,
        });
    }

    Ok(details)
}

#[tauri::command]
pub async fn list_all_branches(repo_path: String) -> Result<Vec<BranchDetail>, String> {
    tokio::task::spawn_blocking(move || list_all_branches_sync(repo_path))
        .await
        .map_err(|e| e.to_string())?
}

/// Extract the hostname from a git remote URL.
/// Handles HTTPS (`https://github.com/...`), SCP-style SSH (`git@github.com:...`),
/// and `ssh://` URLs.
fn host_from_url(url: &str) -> &str {
    if let Some(rest) = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://")) {
        rest.split('/').next().unwrap_or("")
    } else if let Some(rest) = url.strip_prefix("ssh://") {
        // Strip optional user@ prefix, then take the host segment.
        let rest = rest.splitn(2, '@').last().unwrap_or(rest);
        rest.split('/').next().unwrap_or("")
    } else if let Some(at) = url.find('@') {
        // SCP-style: git@github.com:owner/repo.git
        let after = &url[at + 1..];
        after.split(':').next().unwrap_or("")
    } else {
        ""
    }
}

/// Glob-style pattern matching for SSH `Host` entries (case-insensitive).
/// Supports `*` (any sequence) and `?` (single character).
fn ssh_host_matches(pattern: &str, host: &str) -> bool {
    fn matches(p: &[u8], h: &[u8]) -> bool {
        match p.first() {
            None => h.is_empty(),
            Some(&b'*') => (0..=h.len()).any(|i| matches(&p[1..], &h[i..])),
            Some(&b'?') => !h.is_empty() && matches(&p[1..], &h[1..]),
            Some(&c) => {
                !h.is_empty()
                    && c.to_ascii_lowercase() == h[0].to_ascii_lowercase()
                    && matches(&p[1..], &h[1..])
            }
        }
    }
    matches(pattern.as_bytes(), host.as_bytes())
}

/// Parse `~/.ssh/config` and return `IdentityFile` paths for all `Host` blocks
/// that match `host`, in config-file order. Expands `~/` in paths.
fn ssh_identity_files_for_host(host: &str, home: &str) -> Vec<std::path::PathBuf> {
    let config_path = std::path::Path::new(home).join(".ssh").join("config");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let expand = |p: &str| -> std::path::PathBuf {
        match p.strip_prefix("~/") {
            Some(rest) => std::path::PathBuf::from(format!("{}/{}", home, rest)),
            None => std::path::PathBuf::from(p),
        }
    };

    let mut files: Vec<std::path::PathBuf> = vec![];
    let mut in_matching_block = false;
    let mut seen_host_directive = false;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        // Split keyword from value on first whitespace or '='.
        let Some(sep) = line.find(|c: char| c.is_whitespace() || c == '=') else {
            continue;
        };
        let keyword = &line[..sep];
        let value = line[sep..].trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim();

        if keyword.eq_ignore_ascii_case("Host") {
            seen_host_directive = true;
            // A negated pattern (`!pat`) always overrides a positive match.
            // Block matches iff at least one positive pattern matches AND no negated pattern matches.
            let mut pos_match = false;
            let mut neg_match = false;
            let mut has_positive = false;
            for p in value.split_whitespace() {
                if let Some(neg) = p.strip_prefix('!') {
                    if ssh_host_matches(neg, host) { neg_match = true; }
                } else {
                    has_positive = true;
                    if ssh_host_matches(p, host) { pos_match = true; }
                }
            }
            in_matching_block = (!has_positive || pos_match) && !neg_match;
            continue;
        }

        if keyword.eq_ignore_ascii_case("Match") {
            // Match blocks have complex semantics — skip conservatively.
            seen_host_directive = true;
            in_matching_block = false;
            continue;
        }

        // Lines before any Host directive apply globally (implicit `Host *`).
        let applies = !seen_host_directive || in_matching_block;
        if applies && keyword.eq_ignore_ascii_case("IdentityFile") {
            let path = expand(value);
            if !files.contains(&path) {
                files.push(path);
            }
        }
    }

    files
}

/// Resolve the ordered list of SSH private key paths to try for a remote URL.
/// Reads `~/.ssh/config` for host-specific keys; falls back to scanning
/// `~/.ssh/` for any file that has a `.pub` counterpart (standard private-key
/// heuristic), so custom key names like `~/.ssh/github` are picked up too.
/// Only returns paths that exist on disk, ordered by preference (ed25519 first).
static SSH_KEY_CACHE: LazyLock<Mutex<HashMap<String, Vec<std::path::PathBuf>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn resolve_ssh_keys(url: &str) -> Vec<std::path::PathBuf> {
    let host = host_from_url(url).to_string();
    if let Ok(cache) = SSH_KEY_CACHE.lock() {
        if let Some(keys) = cache.get(&host) {
            return keys.clone();
        }
    }
    let keys = resolve_ssh_keys_uncached(url);
    if let Ok(mut cache) = SSH_KEY_CACHE.lock() {
        cache.insert(host, keys.clone());
    }
    keys
}

fn resolve_ssh_keys_uncached(url: &str) -> Vec<std::path::PathBuf> {
    let home = std::env::var("HOME").unwrap_or_default();
    let host = host_from_url(url);
    let mut keys = ssh_identity_files_for_host(host, &home);

    if keys.is_empty() {
        let ssh_dir = std::path::Path::new(&home).join(".ssh");
        if let Ok(entries) = std::fs::read_dir(&ssh_dir) {
            keys = entries
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.extension().map_or(true, |ext| ext != "pub")
                        && p.with_extension("pub").exists()
                })
                .collect();
            // ed25519 before rsa before others — more modern keys first.
            keys.sort_unstable_by_key(|p| {
                let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
                if name.contains("ed25519") { 0u8 } else if name.contains("rsa") { 1 } else { 2 }
            });
        }
    }

    keys.into_iter().filter(|p| p.exists()).collect()
}

/// Build a stateful credential callback for libgit2.
///
/// Attempt 0 → SSH agent. Attempts 1..n → `ssh_keys[n-1]`. Falls back to
/// the git credential helper for HTTPS. Returns `Err` when all options are
/// exhausted, which tells libgit2 to stop retrying.
fn build_credential_callback<'a>(
    ssh_keys: &'a [std::path::PathBuf],
    attempt: &'a std::cell::Cell<usize>,
    config: Option<&'a git2::Config>,
) -> impl FnMut(&str, Option<&str>, git2::CredentialType) -> Result<git2::Cred, git2::Error> + 'a
{
    move |remote_url, username_from_url, allowed_types| {
        let username = username_from_url.unwrap_or("git");
        let n = attempt.get();
        attempt.set(n + 1);

        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            if n == 0 {
                return git2::Cred::ssh_key_from_agent(username);
            }
            if let Some(key_path) = ssh_keys.get(n - 1) {
                // Pass None for the public key — libgit2 derives it from the private key automatically.
                return git2::Cred::ssh_key(username, None, key_path, None);
            }
            return Err(git2::Error::from_str("no SSH credentials available"));
        }

        if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Some(cfg) = config {
                return git2::Cred::credential_helper(cfg, remote_url, username_from_url);
            }
        }

        Err(git2::Error::from_str("no credentials available"))
    }
}

/// Extract the repository name from a remote URL (HTTPS or SSH).
fn repo_name_from_url(url: &str) -> Option<String> {
    let trimmed = url.trim_end_matches('/');
    let base = trimmed.rsplit('/').next()?;
    // SSH URLs: git@host:owner/repo.git — take after the last '/'
    let base = base.rsplit(':').next().unwrap_or(base);
    let name = base.strip_suffix(".git").unwrap_or(base);
    if name.is_empty() { None } else { Some(name.to_string()) }
}

fn fetch_remote_sync(repo_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("no 'origin' remote: {e}"))?;

    let remote_url = remote.url().unwrap_or("").to_string();
    let ssh_keys = resolve_ssh_keys(&remote_url);
    let attempt = std::cell::Cell::new(0usize);
    let config = repo.config().ok();

    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(build_credential_callback(&ssh_keys, &attempt, config.as_ref()));

    let mut fetch_opts = git2::FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);
    fetch_opts.prune(FetchPrune::On);

    remote
        .fetch(&[] as &[&str], Some(&mut fetch_opts), None)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn fetch_remote(repo_path: String) -> Result<(), String> {
    let path = repo_path.clone();
    mutate_and_invalidate(repo_path, move || fetch_remote_sync(&path)).await
}

#[tauri::command]
pub async fn clone_repo(
    app_handle: tauri::AppHandle,
    project_id: String,
    url: String,
    dest: String,
    branch: Option<String>,
) -> Result<RepoInfo, String> {
    tokio::task::spawn_blocking(move || {
        let ssh_keys = resolve_ssh_keys(&url);
        let attempt = std::cell::Cell::new(0usize);
        let config = git2::Config::open_default().ok();

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(build_credential_callback(&ssh_keys, &attempt, config.as_ref()));

        // Phase 0 = receiving, 1 = resolving — tracked to reset last_emitted on phase change
        let mut last_phase: u8 = 0;
        let mut last_emitted: usize = 0;
        let pid = project_id.clone();
        let ah = app_handle.clone();
        callbacks.transfer_progress(move |stats| {
            let received = stats.received_objects();
            let total_obj = stats.total_objects();
            let indexed = stats.indexed_deltas();
            let total_deltas = stats.total_deltas();

            let (phase_byte, phase_str, step, total_step) = if received < total_obj {
                (0u8, "receiving", received, total_obj)
            } else {
                (1u8, "resolving", indexed, total_deltas.max(1))
            };

            let threshold = (total_step / 100).max(50);
            let phase_changed = phase_byte != last_phase;
            let at_threshold = step == total_step || step.saturating_sub(last_emitted) >= threshold;

            if phase_changed || at_threshold {
                if phase_changed { last_phase = phase_byte; }
                last_emitted = step;
                let _ = ah.emit("clone-progress", CloneProgressPayload {
                    project_id: pid.clone(),
                    phase: phase_str.to_string(),
                    step,
                    total: total_step,
                    bytes: stats.received_bytes(),
                });
            }
            true
        });

        let mut fetch_opts = git2::FetchOptions::new();
        fetch_opts.remote_callbacks(callbacks);

        let repo_name = repo_name_from_url(&url)
            .ok_or_else(|| format!("cannot derive repository name from URL: {url}"))?;
        let expanded_dest = if dest.starts_with("~/") {
            let home = std::env::var("HOME")
                .map_err(|_| "Could not expand ~: HOME is not set".to_string())?;
            format!("{}{}", home, &dest[1..])
        } else {
            dest.clone()
        };
        // If the target directory already exists, append -1, -2, … until free.
        let dest_path = {
            let base = Path::new(&expanded_dest).join(&repo_name);
            if !base.exists() {
                base
            } else {
                let mut i = 1u32;
                loop {
                    let candidate = Path::new(&expanded_dest).join(format!("{}-{}", repo_name, i));
                    if !candidate.exists() {
                        break candidate;
                    }
                    i += 1;
                }
            }
        };

        let ah2 = app_handle.clone();
        let pid2 = project_id.clone();
        let mut last_checkout: usize = 0;
        let mut checkout_builder = git2::build::CheckoutBuilder::new();
        checkout_builder.progress(move |_, cur, total| {
            if total == 0 { return; }
            let threshold = (total / 100).max(10);
            if cur == total || cur.saturating_sub(last_checkout) >= threshold {
                last_checkout = cur;
                let _ = ah2.emit("clone-progress", CloneProgressPayload {
                    project_id: pid2.clone(),
                    phase: "checkout".to_string(),
                    step: cur,
                    total,
                    bytes: 0,
                });
            }
        });

        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fetch_opts);
        builder.with_checkout(checkout_builder);
        if let Some(ref b) = branch {
            builder.branch(b);
        }
        let repo = builder.clone(&url, &dest_path).map_err(|e| e.to_string())?;

        let dest_str = dest_path.to_string_lossy().to_string();
        let head_name = repo
            .head()
            .ok()
            .and_then(|h| h.shorthand().map(|s| s.to_string()))
            .unwrap_or_else(|| branch.unwrap_or_else(|| "main".to_string()));

        Ok(RepoInfo {
            path: dest_str,
            name: repo_name,
            branches: vec![BranchInfo { name: head_name, is_head: true, ahead: 0, behind: 0 }],
            worktrees: Vec::new(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

fn friendly_remote_error(msg: &str) -> String {
    let lower = msg.to_lowercase();
    if lower.contains("authentication")
        || lower.contains("permission denied")
        || lower.contains("credentials")
        || lower.contains("authorization")
    {
        return "Authentication failed — check your SSH keys or credentials".to_string();
    }
    if lower.contains("not found")
        || lower.contains("does not exist")
        || lower.contains("repository not found")
        || lower.contains("access denied")
    {
        return "Repository not found".to_string();
    }
    if lower.contains("unable to connect")
        || lower.contains("could not resolve")
        || lower.contains("name or service not known")
        || lower.contains("connection refused")
        || lower.contains("timed out")
    {
        return "Could not connect — check your network connection".to_string();
    }
    msg.to_string()
}

#[tauri::command]
pub async fn check_remote(url: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let ssh_keys = resolve_ssh_keys(&url);
        let attempt = std::cell::Cell::new(0usize);
        let config = git2::Config::open_default().ok();

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(build_credential_callback(&ssh_keys, &attempt, config.as_ref()));

        let mut remote = git2::Remote::create_detached(url.as_str())
            .map_err(|_| "Invalid repository URL".to_string())?;

        let _conn = remote
            .connect_auth(git2::Direction::Fetch, Some(callbacks), None)
            .map_err(|e| friendly_remote_error(e.message()))?;

        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_remote_branches(url: String) -> Result<Vec<BranchInfo>, String> {
    tokio::task::spawn_blocking(move || {
        let ssh_keys = resolve_ssh_keys(&url);
        let attempt = std::cell::Cell::new(0usize);
        let config = git2::Config::open_default().ok();

        let mut callbacks = git2::RemoteCallbacks::new();
        callbacks.credentials(build_credential_callback(&ssh_keys, &attempt, config.as_ref()));

        let mut remote = git2::Remote::create_detached(url.as_str())
            .map_err(|_| "Invalid repository URL".to_string())?;

        let conn = remote
            .connect_auth(git2::Direction::Fetch, Some(callbacks), None)
            .map_err(|e| friendly_remote_error(e.message()))?;

        let refs = conn.list().map_err(|e| e.to_string())?;

        // HEAD symref points to the default branch (e.g. "refs/heads/main")
        let default_branch = refs
            .iter()
            .find(|r| r.name() == "HEAD")
            .and_then(|r| r.symref_target())
            .and_then(|t| t.strip_prefix("refs/heads/"))
            .map(|s| s.to_string());

        let branches: Vec<BranchInfo> = refs
            .iter()
            .filter_map(|r| {
                r.name().strip_prefix("refs/heads/").map(|name| {
                    let is_head = default_branch.as_deref() == Some(name);
                    BranchInfo { name: name.to_string(), is_head, ahead: 0, behind: 0 }
                })
            })
            .collect();

        Ok(branches)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn create_branch(
    repo_path: String,
    name: String,
    base: String,
) -> Result<BranchInfo, String> {
    let path = repo_path.clone();
    mutate_and_invalidate(repo_path, move || {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;
        let base_branch = repo
            .find_branch(&base, BranchType::Local)
            .map_err(|e| e.to_string())?;
        let commit = base_branch
            .get()
            .peel_to_commit()
            .map_err(|e| e.to_string())?;
        let branch = repo
            .branch(&name, &commit, false)
            .map_err(|e| e.to_string())?;
        Ok(BranchInfo {
            name,
            is_head: branch.is_head(),
            ahead: 0,
            behind: 0,
        })
    })
    .await
}

#[tauri::command]
pub async fn delete_branch(repo_path: String, name: String) -> Result<(), String> {
    let path = repo_path.clone();
    mutate_and_invalidate(repo_path, move || {
        let repo = Repository::open(&path).map_err(|e| e.to_string())?;
        let mut branch = repo
            .find_branch(&name, BranchType::Local)
            .map_err(|e| e.to_string())?;
        if branch.is_head() {
            return Err("Cannot delete the currently checked-out branch.".to_string());
        }
        branch.delete().map_err(|e| e.to_string())?;
        Ok(())
    })
    .await
}

/// Find a branch commit, trying local first then origin remote.
fn find_branch_commit<'repo>(
    repo: &'repo Repository,
    branch_name: &str,
) -> Result<git2::Commit<'repo>, String> {
    if let Ok(branch) = repo.find_branch(branch_name, BranchType::Local) {
        return branch.get().peel_to_commit().map_err(|e| e.to_string());
    }
    let remote_name = format!("origin/{}", branch_name);
    let remote_branch = repo
        .find_branch(&remote_name, BranchType::Remote)
        .map_err(|_| {
            format!(
                "Branch \"{}\" not found locally or as origin/{}",
                branch_name, branch_name
            )
        })?;
    remote_branch
        .get()
        .peel_to_commit()
        .map_err(|e| e.to_string())
}

/// Find a local branch, or create a local tracking branch from origin if not found.
fn find_local_or_tracking_branch<'repo>(
    repo: &'repo Repository,
    branch_name: &str,
) -> Result<git2::Branch<'repo>, String> {
    match repo.find_branch(branch_name, BranchType::Local) {
        Ok(b) => Ok(b),
        Err(_) => {
            let remote_name = format!("origin/{}", branch_name);
            let remote_branch = repo
                .find_branch(&remote_name, BranchType::Remote)
                .map_err(|_| {
                    format!(
                        "Branch \"{}\" not found locally or as origin/{}",
                        branch_name, branch_name
                    )
                })?;
            let commit = remote_branch
                .get()
                .peel_to_commit()
                .map_err(|e| e.to_string())?;
            repo.branch(branch_name, &commit, false)
                .map_err(|e| format!("Failed to create local branch from remote: {}", e))
        }
    }
}

fn create_worktree_sync(
    repo_path: String,
    name: String,
    path: String,
    base_branch: Option<String>,
    new_branch: Option<String>,
) -> Result<WorktreeInfo, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut opts = WorktreeAddOptions::new();

    // Hold the reference in scope so opts can borrow it
    let _ref_holder;
    if let Some(ref new_branch_name) = new_branch {
        // Create a new branch from base_branch, then use it as reference
        let base = base_branch.as_deref().unwrap_or("main");
        let base_commit = find_branch_commit(&repo, base)?;
        let branch = repo
            .branch(new_branch_name, &base_commit, false)
            .map_err(|e| format!("Failed to create branch \"{}\": {}", new_branch_name, e))?;
        _ref_holder = branch.into_reference();
        opts.reference(Some(&_ref_holder));
    } else if let Some(ref branch_name) = base_branch {
        let existing_wts = enumerate_worktrees(&repo)?;
        if let Some(existing) = existing_wts.iter().find(|w| w.branch == *branch_name) {
            return Ok(existing.clone());
        }
        // Use an existing branch as-is
        let branch = find_local_or_tracking_branch(&repo, branch_name)?;
        _ref_holder = branch.into_reference();
        opts.reference(Some(&_ref_holder));
    }

    let safe_name = sanitize_worktree_name(&name);
    eprintln!("[git] create_worktree: name={name:?} safe_name={safe_name:?} path={path:?}");

    // Expand ~ to home directory
    let expanded_path = if path.starts_with("~/") {
        let home = std::env::var("HOME").map_err(|_| {
            "Could not expand ~: HOME environment variable is not set".to_string()
        })?;
        format!("{}{}", home, &path[1..])
    } else {
        path.clone()
    };
    let target = Path::new(&expanded_path);

    if target.exists() {
        // Already a registered worktree at this path — return it instead of erroring.
        let canonical_target = target.canonicalize().ok();
        let existing_wts = enumerate_worktrees(&repo)?;
        if let Some(existing) = existing_wts.iter().find(|w| {
            Path::new(&w.path).canonicalize().ok() == canonical_target
        }) {
            return Ok(existing.clone());
        }
        return Err(format!(
            "Target path \"{}\" already exists. Choose a different location.",
            path
        ));
    }

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            match e.kind() {
                std::io::ErrorKind::PermissionDenied => {
                    format!("Permission denied creating directory: {}", parent.display())
                }
                _ => format!("Cannot create directory {}: {}", parent.display(), e),
            }
        })?;
    }

    let wt = repo
        .worktree(&safe_name, target, Some(&opts))
        .map_err(|e| format!("Git worktree failed ({:?}): {}", e.class(), e.message()))?;

    let wt_name = wt.name().unwrap_or("").to_string();
    let wt_path = wt.path().to_string_lossy().to_string();
    // The branch is the new_branch if provided, otherwise the base_branch
    let branch = new_branch
        .as_deref()
        .or(base_branch.as_deref())
        .unwrap_or(&wt_name)
        .to_string();

    Ok(WorktreeInfo {
        name: wt_name,
        path: wt_path,
        branch,
    })
}

#[tauri::command]
pub async fn create_worktree(
    repo_path: String,
    name: String,
    path: String,
    base_branch: Option<String>,
    new_branch: Option<String>,
) -> Result<WorktreeInfo, String> {
    let rp = repo_path.clone();
    mutate_and_invalidate(repo_path, move || {
        create_worktree_sync(rp, name, path, base_branch, new_branch)
    })
    .await
}

fn remove_worktree_sync(repo_path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let safe_name = sanitize_worktree_name(&name);
    eprintln!("[git] remove_worktree: name={name:?} safe_name={safe_name:?}");
    let wt = repo
        .find_worktree(&safe_name)
        .map_err(|e| e.to_string())?;
    if wt.is_locked().ok().map_or(false, |status| {
        matches!(status, git2::WorktreeLockStatus::Locked(_))
    }) {
        return Err(format!(
            "Worktree \"{}\" is locked and cannot be removed.",
            name
        ));
    }
    let mut prune_opts = WorktreePruneOptions::new();
    prune_opts.valid(true).working_tree(true);
    wt.prune(Some(&mut prune_opts)).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn remove_worktree(repo_path: String, name: String) -> Result<(), String> {
    let rp = repo_path.clone();
    mutate_and_invalidate(repo_path, move || remove_worktree_sync(rp, name)).await
}

/// Compute diff stats between a base tree and a branch tip tree.
fn diff_stat_for_tree(
    repo: &Repository,
    base_tree: &git2::Tree,
    tip_tree: &git2::Tree,
) -> Option<DiffStat> {
    let diff = repo.diff_tree_to_tree(Some(base_tree), Some(tip_tree), None).ok()?;
    let stats = diff.stats().ok()?;
    let additions = stats.insertions();
    let deletions = stats.deletions();
    if additions == 0 && deletions == 0 {
        return None;
    }
    Some(DiffStat { additions, deletions })
}

/// Find the local default branch (main or master) and return its tip tree.
fn find_default_branch_tree<'a>(repo: &'a Repository) -> Option<git2::Tree<'a>> {
    for name in &["main", "master"] {
        if let Ok(branch) = repo.find_branch(name, BranchType::Local) {
            if let Ok(commit) = branch.get().peel_to_commit() {
                return commit.tree().ok();
            }
        }
    }
    None
}

#[tauri::command]
pub async fn get_diff_stats(repo_path: String) -> Result<HashMap<String, DiffStat>, String> {
    tokio::task::spawn_blocking(move || get_diff_stats_sync(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_all_diff_stats(
    repo_paths: Vec<String>,
) -> Result<HashMap<String, HashMap<String, DiffStat>>, String> {
    let semaphore = Arc::new(Semaphore::new(6));
    let mut handles = Vec::with_capacity(repo_paths.len());

    for path in repo_paths {
        let sem = semaphore.clone();
        let key = path.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let stats = tokio::task::spawn_blocking(move || get_diff_stats_sync(&path))
                .await
                .map_err(|e| e.to_string())??;
            Ok::<_, String>((key, stats))
        }));
    }

    let mut result = HashMap::new();
    for handle in handles {
        match handle.await {
            Ok(Ok((key, stats))) => {
                result.insert(key, stats);
            }
            Ok(Err(e)) => eprintln!("get_all_diff_stats: repo failed: {e}"),
            Err(e) => eprintln!("get_all_diff_stats: task panicked: {e}"),
        }
    }
    Ok(result)
}

fn get_diff_stats_for_repo(
    repo: &Repository,
    known_wt_branches: Option<&HashMap<String, String>>,
) -> Result<HashMap<String, DiffStat>, String> {
    let base_tree = match find_default_branch_tree(repo) {
        Some(t) => t,
        None => return Ok(HashMap::new()),
    };

    let head_ref = repo.head().map_err(|e| e.to_string())?;
    let head_name = head_ref.shorthand().unwrap_or("HEAD").to_string();

    let mut stats_map = HashMap::new();

    // For HEAD branch: diff default branch tree → working tree (committed + uncommitted)
    if let Ok(diff) = repo.diff_tree_to_workdir_with_index(Some(&base_tree), None) {
        if let Ok(stats) = diff.stats() {
            let additions = stats.insertions();
            let deletions = stats.deletions();
            if additions > 0 || deletions > 0 {
                stats_map.insert(head_name.clone(), DiffStat { additions, deletions });
            }
        }
    }

    for branch_result in repo
        .branches(Some(BranchType::Local))
        .map_err(|e| e.to_string())?
    {
        let (branch, _) = branch_result.map_err(|e| e.to_string())?;
        let name = branch
            .name()
            .map_err(|e| e.to_string())?
            .unwrap_or("(invalid utf8)")
            .to_string();

        // HEAD is already handled above via working tree diff
        if name == head_name {
            continue;
        }

        if let Ok(commit) = branch.get().peel_to_commit() {
            if let Ok(branch_tree) = commit.tree() {
                if let Some(stat) = diff_stat_for_tree(repo, &base_tree, &branch_tree) {
                    stats_map.insert(name, stat);
                }
            }
        }
    }

    // Worktree HEADs not yet covered by the local branch loop (e.g. detached HEAD)
    // Use pre-computed map if available to avoid redundant Repository::open calls
    let resolved: HashMap<String, String>;
    let wt_branches = match known_wt_branches {
        Some(m) => m,
        None => {
            let mut tmp = HashMap::new();
            if let Ok(wt_names) = repo.worktrees() {
                for wt_name in wt_names.iter() {
                    let wt_name = match wt_name {
                        Some(n) => n,
                        None => continue,
                    };
                    let wt = match repo.find_worktree(wt_name) {
                        Ok(wt) if wt.validate().is_ok() => wt,
                        _ => continue,
                    };
                    if let Some(branch) = resolve_worktree_branch(wt_name, wt.path(), repo) {
                        tmp.insert(wt_name.to_string(), branch);
                    }
                }
            }
            resolved = tmp;
            &resolved
        }
    };
    for branch_name in wt_branches.values() {
        if stats_map.contains_key(branch_name) {
            continue;
        }
        if let Ok(branch) = repo.find_branch(branch_name, BranchType::Local) {
            if let Ok(commit) = branch.get().peel_to_commit() {
                if let Ok(wt_tree) = commit.tree() {
                    if let Some(stat) = diff_stat_for_tree(repo, &base_tree, &wt_tree) {
                        stats_map.insert(branch_name.clone(), stat);
                    }
                }
            }
        }
    }

    Ok(stats_map)
}

fn get_diff_stats_sync(repo_path: &str) -> Result<HashMap<String, DiffStat>, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;
    get_diff_stats_for_repo(&repo, None)
}

#[derive(Serialize, Clone)]
pub struct ProjectPollState {
    pub head_oid: String,
    pub branches: Vec<BranchInfo>,
    pub worktree_branches: HashMap<String, String>,
    pub diff_stats: HashMap<String, DiffStat>,
}

fn poll_project_state_sync(repo_path: &str) -> Result<ProjectPollState, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    // 1. Build cheap fingerprint before doing expensive work.
    let head_oid = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string())
        .unwrap_or_default();

    let index_mtime = std::fs::metadata(repo.path().join("index"))
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);

    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut worktree_heads: Vec<(String, String)> = Vec::new();
    for wt_name in wt_names.iter() {
        let wt_name = match wt_name {
            Some(n) => n,
            None => continue,
        };
        let head_path = repo.path().join("worktrees").join(wt_name).join("HEAD");
        let content = std::fs::read_to_string(&head_path).unwrap_or_default();
        worktree_heads.push((wt_name.to_string(), content));
    }

    let fingerprint = PollFingerprint {
        head_oid: head_oid.clone(),
        index_mtime,
        worktree_heads,
    };

    // 2. Return cached state if fingerprint unchanged.
    if let Ok(cache) = POLL_CACHE.lock() {
        if let Some(cached) = cache.get(repo_path) {
            if cached.fingerprint == fingerprint {
                return Ok(cached.state.clone());
            }
        }
    }

    // 3. Full computation — fingerprint changed.
    let branches = enumerate_branches(&repo, true)?;

    let mut worktree_branches = HashMap::new();
    for wt_name in wt_names.iter() {
        let wt_name = match wt_name {
            Some(n) => n,
            None => continue,
        };
        if let Ok(wt) = repo.find_worktree(wt_name) {
            if wt.validate().is_ok() {
                if let Some(branch) = resolve_worktree_branch(wt_name, wt.path(), &repo) {
                    worktree_branches.insert(wt_name.to_string(), branch);
                }
            }
        }
    }

    let diff_stats = get_diff_stats_for_repo(&repo, Some(&worktree_branches))?;

    let state = ProjectPollState {
        head_oid,
        branches,
        worktree_branches,
        diff_stats,
    };

    // 4. Update cache.
    if let Ok(mut cache) = POLL_CACHE.lock() {
        cache.insert(
            repo_path.to_string(),
            CachedPoll { fingerprint, state: state.clone() },
        );
    }

    Ok(state)
}

#[tauri::command]
pub async fn poll_all_project_states(
    repo_paths: Vec<String>,
) -> Result<HashMap<String, ProjectPollState>, String> {
    let semaphore = Arc::new(Semaphore::new(6));
    let mut handles = Vec::with_capacity(repo_paths.len());

    for path in repo_paths {
        let sem = semaphore.clone();
        let key = path.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let state = tokio::task::spawn_blocking(move || poll_project_state_sync(&path))
                .await
                .map_err(|e| e.to_string())??;
            Ok::<_, String>((key, state))
        }));
    }

    let mut result = HashMap::new();
    for handle in handles {
        match handle.await {
            Ok(Ok((key, state))) => {
                result.insert(key, state);
            }
            Ok(Err(e)) => eprintln!("poll_all_project_states: repo failed: {e}"),
            Err(e) => eprintln!("poll_all_project_states: task panicked: {e}"),
        }
    }
    Ok(result)
}

/// Returns the subset of paths that are **not** valid git repository directories.
/// Used at boot to detect projects whose directories have been deleted.
#[tauri::command]
pub async fn check_project_paths(paths: Vec<String>) -> Vec<String> {
    paths
        .into_iter()
        .filter(|p| !Path::new(p).is_dir())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Create a test repo with an initial commit so branches exist
    fn init_repo_with_commit(dir: &std::path::Path) -> Repository {
        let repo = Repository::init(dir).expect("init repo");
        // Create an initial commit
        {
            let sig = repo.signature().unwrap_or_else(|_| {
                git2::Signature::now("Test", "test@test.com").unwrap()
            });
            let tree_id = repo.index().unwrap().write_tree().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .unwrap();
        }
        repo
    }

    #[tokio::test]
    async fn test_import_repo() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        // Create extra branches that should NOT appear in import
        let branches = list_branches(path.clone()).await.unwrap();
        let default_branch = &branches[0].name;
        create_branch(path.clone(), "extra-branch".to_string(), default_branch.clone()).await.unwrap();

        let info = import_repo(path).await.unwrap();
        assert_eq!(info.name, tmp.path().file_name().unwrap().to_string_lossy());
        // Should only have the HEAD branch
        assert_eq!(info.branches.len(), 1);
        assert!(info.branches[0].is_head);
        // Should have no worktrees
        assert!(info.worktrees.is_empty());
    }

    #[tokio::test]
    async fn test_create_and_list_branches() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        // Get the default branch name
        let branches_before = list_branches(path.clone()).await.unwrap();
        let default_branch = &branches_before[0].name;

        create_branch(path.clone(), "feature/test".to_string(), default_branch.clone())
            .await.unwrap();
        let branches = list_branches(path).await.unwrap();
        assert!(branches.iter().any(|b| b.name == "feature/test"));
    }

    #[tokio::test]
    async fn test_delete_branch() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).await.unwrap();
        let default_branch = &branches[0].name;

        create_branch(path.clone(), "to-delete".to_string(), default_branch.clone())
            .await.unwrap();
        delete_branch(path.clone(), "to-delete".to_string()).await.unwrap();
        let branches = list_branches(path).await.unwrap();
        assert!(!branches.iter().any(|b| b.name == "to-delete"));
    }

    #[tokio::test]
    async fn test_delete_head_branch_fails() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).await.unwrap();
        let head_branch = branches.iter().find(|b| b.is_head).unwrap();

        let result = delete_branch(path, head_branch.name.clone()).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot delete"));
    }

    #[tokio::test]
    async fn test_create_and_remove_worktree() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("test-worktree");
        let wt = create_worktree(
            path.clone(),
            "test-wt".to_string(),
            wt_path.to_string_lossy().to_string(),
            None,
            None,
        )
        .await.unwrap();
        assert_eq!(wt.name, "test-wt");
        assert!(wt_path.exists());

        // Now remove it
        remove_worktree(path.clone(), "test-wt".to_string()).await.unwrap();
        // After prune, the worktree dir may still exist but git won't list it
        let info = import_repo(path).await.unwrap();
        assert!(!info.worktrees.iter().any(|w| w.name == "test-wt"));
    }

    #[tokio::test]
    async fn test_create_worktree_with_slashes_in_name() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("feat-my-feature");
        let wt = create_worktree(
            path.clone(),
            "feat/my-feature".to_string(),
            wt_path.to_string_lossy().to_string(),
            None,
            None,
        )
        .await
        .unwrap();
        // Slashes replaced with dashes in the admin name
        assert_eq!(wt.name, "feat-my-feature");
        assert!(wt_path.exists());
    }

    #[tokio::test]
    async fn test_create_worktree_with_deeply_nested_slashes() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("chore-5-setup-ci");
        let wt = create_worktree(
            path.clone(),
            "chore/5/setup/ci".to_string(),
            wt_path.to_string_lossy().to_string(),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(wt.name, "chore-5-setup-ci");
        assert!(wt_path.exists());
    }

    #[tokio::test]
    async fn test_create_worktree_target_already_exists() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("existing-dir");
        std::fs::create_dir_all(&wt_path).unwrap();

        let err = create_worktree(
            path,
            "test-wt".to_string(),
            wt_path.to_string_lossy().to_string(),
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(err.contains("already exists"), "expected 'already exists' error, got: {err}");
    }

    #[tokio::test]
    async fn test_list_all_branches() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches_before = list_branches(path.clone()).await.unwrap();
        let default_branch = &branches_before[0].name;
        create_branch(path.clone(), "feature/test".to_string(), default_branch.clone()).await.unwrap();

        let details = list_all_branches(path).await.unwrap();
        assert!(details.len() >= 2);

        let head = details.iter().find(|b| b.is_head).unwrap();
        assert!(head.is_local);
        assert!(!head.is_in_worktree);

        let feat = details.iter().find(|b| b.name == "feature/test").unwrap();
        assert!(!feat.is_head);
        assert!(feat.is_local);
        assert!(!feat.is_in_worktree);
    }

    #[test]
    fn test_resolve_worktree_branch_prefers_matching_branch() {
        // Setup: repo with initial commit
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let default_branch = repo.head().unwrap().shorthand().unwrap().to_string();

        // Create a branch and a worktree for it
        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("my-feature", &base_commit, false).unwrap();

        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("my-feature");
        let mut opts = WorktreeAddOptions::new();
        let branch_ref = repo.find_branch("my-feature", BranchType::Local).unwrap().into_reference();
        opts.reference(Some(&branch_ref));
        repo.worktree("my-feature", &wt_path, Some(&opts)).unwrap();

        // Verify: resolves to the branch name even though worktree HEAD is on it
        let result = resolve_worktree_branch("my-feature", &wt_path, &repo);
        assert_eq!(result, Some("my-feature".to_string()));

        // Now checkout the default branch inside the worktree (simulating post-merge state)
        let wt_repo = Repository::open(&wt_path).unwrap();
        let default_oid = repo.find_branch(&default_branch, BranchType::Local)
            .unwrap().get().target().unwrap();
        wt_repo.set_head_detached(default_oid).unwrap();

        // The worktree HEAD is now detached, but the branch "my-feature" still exists.
        // resolve_worktree_branch should still return "my-feature".
        let result = resolve_worktree_branch("my-feature", &wt_path, &repo);
        assert_eq!(result, Some("my-feature".to_string()));
    }

    #[test]
    fn test_resolve_worktree_branch_falls_back_to_head() {
        // When the worktree admin name doesn't match any branch (e.g. sanitized slashes),
        // fall back to reading HEAD.
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());

        let base_commit = repo.head().unwrap().peel_to_commit().unwrap();
        repo.branch("feat/cool", &base_commit, false).unwrap();

        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("feat-cool");
        let mut opts = WorktreeAddOptions::new();
        let branch_ref = repo.find_branch("feat/cool", BranchType::Local).unwrap().into_reference();
        opts.reference(Some(&branch_ref));
        // Admin name "feat-cool" won't match branch "feat/cool"
        repo.worktree("feat-cool", &wt_path, Some(&opts)).unwrap();

        let result = resolve_worktree_branch("feat-cool", &wt_path, &repo);
        // Falls back to HEAD which is "feat/cool"
        assert_eq!(result, Some("feat/cool".to_string()));
    }

    /// Creates a repo with a single commit, a branch, and a worktree for that branch.
    /// Returns `(repo_tmp, wt_tmp, repo_path, worktree_info)`.
    async fn setup_worktree(branch: &str) -> (TempDir, TempDir, String, WorktreeInfo) {
        let tmp = TempDir::new().unwrap();
        init_repo_with_commit(tmp.path());
        let repo_path = tmp.path().to_string_lossy().to_string();
        let branches = list_branches(repo_path.clone()).await.unwrap();
        create_branch(repo_path.clone(), branch.to_string(), branches[0].name.clone())
            .await
            .unwrap();
        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join(branch);
        let wt = create_worktree(
            repo_path.clone(),
            branch.to_string(),
            wt_path.to_string_lossy().to_string(),
            Some(branch.to_string()),
            None,
        )
        .await
        .unwrap();
        (tmp, wt_tmp, repo_path, wt)
    }

    #[tokio::test]
    async fn test_create_worktree_idempotent_branch() {
        let (_tmp, wt_tmp, repo_path, first) = setup_worktree("ext-feature").await;

        // Same branch, different canonical Canopy path — should return the existing worktree, not error.
        let canopy_path = wt_tmp.path().join("canopy-ext-feature");
        let second = create_worktree(
            repo_path.clone(),
            "canopy-ext-feature".to_string(),
            canopy_path.to_string_lossy().to_string(),
            Some("ext-feature".to_string()),
            None,
        )
        .await
        .unwrap();

        assert_eq!(second.name, first.name);
        assert_eq!(second.branch, first.branch);
    }

    #[tokio::test]
    async fn test_create_worktree_idempotent_path() {
        let (_tmp, _wt_tmp, repo_path, first) = setup_worktree("path-feature").await;

        // Call again with the exact same path — should return existing worktree
        let second = create_worktree(
            repo_path.clone(),
            "path-feature".to_string(),
            first.path.clone(),
            Some("path-feature".to_string()),
            None,
        )
        .await
        .unwrap();

        assert_eq!(second.name, first.name);
        assert_eq!(second.path, first.path);
        assert_eq!(second.branch, first.branch);
    }

    #[tokio::test]
    async fn test_list_all_branches_detects_worktree() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).await.unwrap();
        let default_branch = &branches[0].name;

        create_branch(path.clone(), "wt-branch".to_string(), default_branch.clone()).await.unwrap();
        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("test-wt");
        create_worktree(
            path.clone(),
            "test-wt".to_string(),
            wt_path.to_string_lossy().to_string(),
            Some("wt-branch".to_string()),
            None,
        ).await.unwrap();

        let details = list_all_branches(path).await.unwrap();
        let wt_branch = details.iter().find(|b| b.name == "wt-branch").unwrap();
        assert!(wt_branch.is_in_worktree);
    }

    #[tokio::test]
    async fn test_ahead_behind_no_upstream() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let info =
            import_repo(tmp.path().to_string_lossy().to_string()).await.unwrap();
        for branch in &info.branches {
            assert_eq!(branch.ahead, 0);
            assert_eq!(branch.behind, 0);
        }
    }

    #[tokio::test]
    async fn test_get_diff_stats() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).await.unwrap();
        let default_branch = &branches[0].name;

        // Create a feature branch and add a file on it
        create_branch(path.clone(), "feature/stats".to_string(), default_branch.clone()).await.unwrap();

        // Checkout the feature branch and create a file
        let branch = repo
            .find_branch("feature/stats", BranchType::Local)
            .unwrap();
        let commit = branch.get().peel_to_commit().unwrap();
        let mut index = repo.index().unwrap();
        // Add a new file blob
        let blob_id = repo.blob(b"hello\nworld\nthree lines\n").unwrap();
        index
            .add(&git2::IndexEntry {
                ctime: git2::IndexTime::new(0, 0),
                mtime: git2::IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: 0o100644,
                uid: 0,
                gid: 0,
                file_size: 0,
                id: blob_id,
                flags: 0,
                flags_extended: 0,
                path: b"new-file.txt".to_vec(),
            })
            .unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = repo.signature().unwrap_or_else(|_| {
            git2::Signature::now("Test", "test@test.com").unwrap()
        });
        repo.commit(
            Some("refs/heads/feature/stats"),
            &sig,
            &sig,
            "Add new file",
            &tree,
            &[&commit],
        )
        .unwrap();

        let stats = get_diff_stats_sync(&path).unwrap();
        assert!(stats.contains_key("feature/stats"));
        let stat = &stats["feature/stats"];
        assert!(stat.additions > 0, "Expected additions > 0, got {}", stat.additions);
        // HEAD branch should not be in the stats
        assert!(!stats.contains_key(default_branch));
    }

    #[test]
    fn test_get_diff_stats_empty_for_no_branches() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        // Only HEAD branch exists — stats should be empty
        let stats = get_diff_stats_sync(&path).unwrap();
        assert!(stats.is_empty());
    }

    /// Helper: create a repo with a feature branch that has changes relative to default branch
    fn create_repo_with_feature_branch(dir: &std::path::Path) -> String {
        let repo = init_repo_with_commit(dir);
        let path = dir.to_string_lossy().to_string();

        let branches = {
            let r = Repository::open(&path).unwrap();
            enumerate_branches(&r, false).unwrap()
        };
        let default_branch = branches[0].name.clone();

        // Create the feature branch directly via git2
        {
            let r = Repository::open(&path).unwrap();
            let branch = r.find_branch(&default_branch, BranchType::Local).unwrap();
            let commit = branch.get().peel_to_commit().unwrap();
            r.branch("feature/batch-test", &commit, false).unwrap();
        }

        // Add a file on the feature branch
        let branch = repo
            .find_branch("feature/batch-test", BranchType::Local)
            .unwrap();
        let commit = branch.get().peel_to_commit().unwrap();
        let mut index = repo.index().unwrap();
        let blob_id = repo.blob(b"batch test content\n").unwrap();
        index
            .add(&git2::IndexEntry {
                ctime: git2::IndexTime::new(0, 0),
                mtime: git2::IndexTime::new(0, 0),
                dev: 0,
                ino: 0,
                mode: 0o100644,
                uid: 0,
                gid: 0,
                file_size: 0,
                id: blob_id,
                flags: 0,
                flags_extended: 0,
                path: b"batch-file.txt".to_vec(),
            })
            .unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let sig = git2::Signature::now("Test", "test@test.com").unwrap();
        repo.commit(
            Some("refs/heads/feature/batch-test"),
            &sig,
            &sig,
            "Add batch file",
            &tree,
            &[&commit],
        )
        .unwrap();

        path
    }

    #[tokio::test]
    async fn test_get_all_diff_stats() {
        // Repo 1: has a feature branch with changes
        let tmp1 = TempDir::new().unwrap();
        let path1 = create_repo_with_feature_branch(tmp1.path());

        // Repo 2: has a feature branch with changes
        let tmp2 = TempDir::new().unwrap();
        let path2 = create_repo_with_feature_branch(tmp2.path());

        // Repo 3: only HEAD branch, no changes
        let tmp3 = TempDir::new().unwrap();
        let _repo3 = init_repo_with_commit(tmp3.path());
        let path3 = tmp3.path().to_string_lossy().to_string();

        let result = get_all_diff_stats(vec![
            path1.clone(),
            path2.clone(),
            path3.clone(),
        ])
        .await
        .unwrap();

        // All three repos should have entries
        assert_eq!(result.len(), 3, "Expected 3 entries, got {}", result.len());
        assert!(result.contains_key(&path1));
        assert!(result.contains_key(&path2));
        assert!(result.contains_key(&path3));

        // Repos with feature branches should have stats
        let stats1 = &result[&path1];
        assert!(
            stats1.contains_key("feature/batch-test"),
            "Repo 1 should have feature/batch-test stats"
        );
        assert!(stats1["feature/batch-test"].additions > 0);

        let stats2 = &result[&path2];
        assert!(
            stats2.contains_key("feature/batch-test"),
            "Repo 2 should have feature/batch-test stats"
        );

        // Repo with only HEAD should have empty stats
        let stats3 = &result[&path3];
        assert!(stats3.is_empty(), "Repo 3 should have empty stats");
    }

    #[tokio::test]
    async fn test_enumerate_branches_lightweight() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).await.unwrap();
        let default_branch = &branches[0].name;
        create_branch(path.clone(), "feature/light".to_string(), default_branch.clone()).await.unwrap();

        let full = enumerate_branches(&repo, false).unwrap();
        let light = enumerate_branches(&repo, true).unwrap();

        // Same branch names and is_head flags
        assert_eq!(full.len(), light.len());
        for (f, l) in full.iter().zip(light.iter()) {
            assert_eq!(f.name, l.name);
            assert_eq!(f.is_head, l.is_head);
        }

        // Lightweight always returns 0 for ahead/behind
        for b in &light {
            assert_eq!(b.ahead, 0);
            assert_eq!(b.behind, 0);
        }
    }

    #[tokio::test]
    async fn test_poll_all_project_states() {
        let tmp1 = TempDir::new().unwrap();
        let path1 = create_repo_with_feature_branch(tmp1.path());

        let tmp2 = TempDir::new().unwrap();
        let _repo2 = init_repo_with_commit(tmp2.path());
        let path2 = tmp2.path().to_string_lossy().to_string();

        let result = poll_all_project_states(vec![path1.clone(), path2.clone()])
            .await
            .unwrap();

        assert_eq!(result.len(), 2);

        // Repo 1: has feature branch + HEAD
        let state1 = &result[&path1];
        assert!(!state1.head_oid.is_empty());
        assert!(state1.branches.len() >= 2);
        assert!(state1.branches.iter().any(|b| b.is_head));
        assert!(state1.branches.iter().any(|b| b.name == "feature/batch-test"));
        // Lightweight: ahead/behind are 0
        for b in &state1.branches {
            assert_eq!(b.ahead, 0);
            assert_eq!(b.behind, 0);
        }
        // Diff stats should be present for feature branch
        assert!(state1.diff_stats.contains_key("feature/batch-test"));

        // Repo 2: only HEAD, no extra branches
        let state2 = &result[&path2];
        assert!(!state2.head_oid.is_empty());
        assert_eq!(state2.branches.len(), 1);
        assert!(state2.diff_stats.is_empty());
        assert!(state2.worktree_branches.is_empty());
    }

    #[test]
    fn test_fetch_remote_no_origin() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();
        let result = fetch_remote_sync(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("origin"));
    }

    #[tokio::test]
    async fn test_fetch_remote_prunes_deleted_branch() {
        // Set up a bare "remote" repo
        let remote_dir = TempDir::new().unwrap();
        let remote_repo = Repository::init_bare(remote_dir.path()).unwrap();
        {
            let sig = git2::Signature::now("Test", "test@test.com").unwrap();
            let tree_id = remote_repo.treebuilder(None).unwrap().write().unwrap();
            let tree = remote_repo.find_tree(tree_id).unwrap();
            let oid = remote_repo
                .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
                .unwrap();
            let commit = remote_repo.find_commit(oid).unwrap();
            remote_repo
                .branch("feature/stale", &commit, false)
                .unwrap();
        }

        // Clone from the bare remote
        let clone_dir = TempDir::new().unwrap();
        let _clone = Repository::clone(
            &remote_dir.path().to_string_lossy(),
            clone_dir.path(),
        )
        .unwrap();
        let clone_path = clone_dir.path().to_string_lossy().to_string();

        // Verify remote branch exists in clone
        let branches_before = list_all_branches(clone_path.clone()).await.unwrap();
        assert!(branches_before.iter().any(|b| b.name == "feature/stale"));

        // Delete the branch on the remote
        remote_repo
            .find_branch("feature/stale", BranchType::Local)
            .unwrap()
            .delete()
            .unwrap();

        // Fetch with prune
        fetch_remote_sync(&clone_path).unwrap();

        // Verify the stale remote tracking branch is gone
        let branches_after = list_all_branches(clone_path).await.unwrap();
        assert!(!branches_after.iter().any(|b| b.name == "feature/stale"));
    }

    #[test]
    fn parse_github_remote_https() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        repo.remote("origin", "https://github.com/acme/widgets").unwrap();
        let result = parse_github_remote(&tmp.path().to_string_lossy());
        assert_eq!(result, Some(("acme".to_string(), "widgets".to_string())));
    }

    #[test]
    fn parse_github_remote_https_with_git_suffix() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        repo.remote("origin", "https://github.com/acme/widgets.git").unwrap();
        let result = parse_github_remote(&tmp.path().to_string_lossy());
        assert_eq!(result, Some(("acme".to_string(), "widgets".to_string())));
    }

    #[test]
    fn parse_github_remote_ssh() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        repo.remote("origin", "git@github.com:acme/widgets.git").unwrap();
        let result = parse_github_remote(&tmp.path().to_string_lossy());
        assert_eq!(result, Some(("acme".to_string(), "widgets".to_string())));
    }

    #[test]
    fn parse_github_remote_ssh_no_suffix() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        repo.remote("origin", "git@github.com:acme/widgets").unwrap();
        let result = parse_github_remote(&tmp.path().to_string_lossy());
        assert_eq!(result, Some(("acme".to_string(), "widgets".to_string())));
    }

    #[test]
    fn parse_github_remote_non_github_host() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        repo.remote("origin", "https://gitlab.com/acme/widgets").unwrap();
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

    #[test]
    fn repo_name_from_https_url() {
        assert_eq!(
            repo_name_from_url("https://github.com/owner/repo.git"),
            Some("repo".to_string()),
        );
    }

    #[test]
    fn repo_name_from_https_no_git_suffix() {
        assert_eq!(
            repo_name_from_url("https://github.com/owner/repo"),
            Some("repo".to_string()),
        );
    }

    #[test]
    fn repo_name_from_ssh_url() {
        assert_eq!(
            repo_name_from_url("git@github.com:owner/repo.git"),
            Some("repo".to_string()),
        );
    }

    #[test]
    fn repo_name_from_trailing_slash() {
        assert_eq!(
            repo_name_from_url("https://github.com/owner/repo/"),
            Some("repo".to_string()),
        );
    }

    #[test]
    fn repo_name_from_empty_url() {
        assert_eq!(repo_name_from_url(""), None);
    }
}
