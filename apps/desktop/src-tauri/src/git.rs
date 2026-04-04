use git2::{BranchType, FetchPrune, Repository, WorktreeAddOptions, WorktreePruneOptions};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Semaphore;

#[derive(Serialize, Clone)]
pub struct BranchInfo {
    pub name: String,
    pub is_head: bool,
    pub ahead: usize,
    pub behind: usize,
}

#[derive(Serialize, Clone)]
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

/// Open a worktree path and resolve which branch is checked out there.
fn resolve_worktree_branch(wt_path: &Path) -> Option<String> {
    let wt_repo = Repository::open(wt_path).ok()?;
    let head = wt_repo.head().ok()?;
    Some(head.shorthand()?.to_string())
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
                    let branch = resolve_worktree_branch(wt.path())
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
pub fn import_repo(path: String) -> Result<RepoInfo, String> {
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
}

#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    enumerate_branches(&repo, false)
}

#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    enumerate_worktrees(&repo)
}

#[tauri::command]
pub fn list_all_branches(repo_path: String) -> Result<Vec<BranchDetail>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    // Collect worktree branch names for cross-reference
    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    let mut wt_branch_names: std::collections::HashSet<String> = std::collections::HashSet::new();
    for wt_name in wt_names.iter() {
        let wt_name = wt_name.ok_or("invalid worktree name")?;
        if let Ok(wt) = repo.find_worktree(wt_name) {
            if wt.validate().is_ok() {
                if let Some(branch) = resolve_worktree_branch(wt.path()) {
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

fn fetch_remote_sync(repo_path: &str) -> Result<(), String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| format!("no 'origin' remote: {e}"))?;

    // Track attempts to avoid infinite retry loops from libgit2
    let attempted = std::cell::Cell::new(false);

    let mut callbacks = git2::RemoteCallbacks::new();
    callbacks.credentials(|url, username_from_url, allowed_types| {
        if attempted.get() {
            return Err(git2::Error::from_str("no credentials available"));
        }
        attempted.set(true);

        let username = username_from_url.unwrap_or("git");

        if allowed_types.contains(git2::CredentialType::SSH_KEY) {
            if let Ok(cred) = git2::Cred::ssh_key_from_agent(username) {
                return Ok(cred);
            }
            let home = match std::env::var("HOME") {
                Ok(h) => h,
                Err(_) => return Err(git2::Error::from_str("HOME not set")),
            };
            for key_name in &["id_ed25519", "id_rsa"] {
                let key_path = std::path::Path::new(&home).join(".ssh").join(key_name);
                if key_path.exists() {
                    let pub_path = key_path.with_extension("pub");
                    let pub_key = if pub_path.exists() {
                        Some(pub_path.as_path())
                    } else {
                        None
                    };
                    if let Ok(cred) =
                        git2::Cred::ssh_key(username, pub_key, &key_path, None)
                    {
                        return Ok(cred);
                    }
                }
            }
        }

        if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT) {
            if let Ok(cfg) = repo.config() {
                if let Ok(cred) =
                    git2::Cred::credential_helper(&cfg, url, username_from_url)
                {
                    return Ok(cred);
                }
            }
        }

        Err(git2::Error::from_str("no credentials available"))
    });

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
    tokio::task::spawn_blocking(move || fetch_remote_sync(&repo_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn create_branch(
    repo_path: String,
    name: String,
    base: String,
) -> Result<BranchInfo, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
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
}

#[tauri::command]
pub fn delete_branch(repo_path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let mut branch = repo
        .find_branch(&name, BranchType::Local)
        .map_err(|e| e.to_string())?;
    if branch.is_head() {
        return Err("Cannot delete the currently checked-out branch.".to_string());
    }
    branch.delete().map_err(|e| e.to_string())?;
    Ok(())
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

#[tauri::command]
pub fn create_worktree(
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
        // Use an existing branch as-is
        let branch = find_local_or_tracking_branch(&repo, branch_name)?;
        _ref_holder = branch.into_reference();
        opts.reference(Some(&_ref_holder));
    }

    // Expand ~ to home directory
    let expanded_path = if path.starts_with("~/") {
        let home = std::env::var("HOME").map_err(|_| "HOME not set".to_string())?;
        format!("{}{}", home, &path[1..])
    } else {
        path.clone()
    };
    let target = Path::new(&expanded_path);

    // Ensure parent directory exists
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    if target.exists() {
        return Err(format!(
            "Target path \"{}\" already exists. Choose a different location.",
            path
        ));
    }

    let wt = repo
        .worktree(&name, target, Some(&opts))
        .map_err(|e| e.to_string())?;

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
pub fn remove_worktree(repo_path: String, name: String) -> Result<(), String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;
    let wt = repo
        .find_worktree(&name)
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
                    if let Some(branch) = resolve_worktree_branch(wt.path()) {
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
pub struct WorkspacePollState {
    pub head_oid: String,
    pub branches: Vec<BranchInfo>,
    pub worktree_branches: HashMap<String, String>,
    pub diff_stats: HashMap<String, DiffStat>,
}

fn poll_workspace_state_sync(repo_path: &str) -> Result<WorkspacePollState, String> {
    let repo = Repository::open(repo_path).map_err(|e| e.to_string())?;

    let branches = enumerate_branches(&repo, true)?;

    let head_oid = repo
        .head()
        .ok()
        .and_then(|h| h.target())
        .map(|oid| oid.to_string())
        .unwrap_or_default();

    let mut worktree_branches = HashMap::new();
    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    for wt_name in wt_names.iter() {
        let wt_name = match wt_name {
            Some(n) => n,
            None => continue,
        };
        if let Ok(wt) = repo.find_worktree(wt_name) {
            if wt.validate().is_ok() {
                if let Some(branch) = resolve_worktree_branch(wt.path()) {
                    worktree_branches.insert(wt_name.to_string(), branch);
                }
            }
        }
    }

    let diff_stats = get_diff_stats_for_repo(&repo, Some(&worktree_branches))?;

    Ok(WorkspacePollState {
        head_oid,
        branches,
        worktree_branches,
        diff_stats,
    })
}

#[tauri::command]
pub async fn poll_all_workspace_states(
    repo_paths: Vec<String>,
) -> Result<HashMap<String, WorkspacePollState>, String> {
    let semaphore = Arc::new(Semaphore::new(6));
    let mut handles = Vec::with_capacity(repo_paths.len());

    for path in repo_paths {
        let sem = semaphore.clone();
        let key = path.clone();
        handles.push(tokio::spawn(async move {
            let _permit = sem.acquire().await.map_err(|e| e.to_string())?;
            let state = tokio::task::spawn_blocking(move || poll_workspace_state_sync(&path))
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
            Ok(Err(e)) => eprintln!("poll_all_workspace_states: repo failed: {e}"),
            Err(e) => eprintln!("poll_all_workspace_states: task panicked: {e}"),
        }
    }
    Ok(result)
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

    #[test]
    fn test_import_repo() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        // Create extra branches that should NOT appear in import
        let branches = list_branches(path.clone()).unwrap();
        let default_branch = &branches[0].name;
        create_branch(path.clone(), "extra-branch".to_string(), default_branch.clone()).unwrap();

        let info = import_repo(path).unwrap();
        assert_eq!(info.name, tmp.path().file_name().unwrap().to_string_lossy());
        // Should only have the HEAD branch
        assert_eq!(info.branches.len(), 1);
        assert!(info.branches[0].is_head);
        // Should have no worktrees
        assert!(info.worktrees.is_empty());
    }

    #[test]
    fn test_create_and_list_branches() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        // Get the default branch name
        let branches_before = list_branches(path.clone()).unwrap();
        let default_branch = &branches_before[0].name;

        create_branch(path.clone(), "feature/test".to_string(), default_branch.clone())
            .unwrap();
        let branches = list_branches(path).unwrap();
        assert!(branches.iter().any(|b| b.name == "feature/test"));
    }

    #[test]
    fn test_delete_branch() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).unwrap();
        let default_branch = &branches[0].name;

        create_branch(path.clone(), "to-delete".to_string(), default_branch.clone())
            .unwrap();
        delete_branch(path.clone(), "to-delete".to_string()).unwrap();
        let branches = list_branches(path).unwrap();
        assert!(!branches.iter().any(|b| b.name == "to-delete"));
    }

    #[test]
    fn test_delete_head_branch_fails() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).unwrap();
        let head_branch = branches.iter().find(|b| b.is_head).unwrap();

        let result = delete_branch(path, head_branch.name.clone());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot delete"));
    }

    #[test]
    fn test_create_and_remove_worktree() {
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
        .unwrap();
        assert_eq!(wt.name, "test-wt");
        assert!(wt_path.exists());

        // Now remove it
        remove_worktree(path.clone(), "test-wt".to_string()).unwrap();
        // After prune, the worktree dir may still exist but git won't list it
        let info = import_repo(path).unwrap();
        assert!(!info.worktrees.iter().any(|w| w.name == "test-wt"));
    }

    #[test]
    fn test_list_all_branches() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches_before = list_branches(path.clone()).unwrap();
        let default_branch = &branches_before[0].name;
        create_branch(path.clone(), "feature/test".to_string(), default_branch.clone()).unwrap();

        let details = list_all_branches(path).unwrap();
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
    fn test_list_all_branches_detects_worktree() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).unwrap();
        let default_branch = &branches[0].name;

        create_branch(path.clone(), "wt-branch".to_string(), default_branch.clone()).unwrap();
        let wt_tmp = TempDir::new().unwrap();
        let wt_path = wt_tmp.path().join("test-wt");
        create_worktree(
            path.clone(),
            "test-wt".to_string(),
            wt_path.to_string_lossy().to_string(),
            Some("wt-branch".to_string()),
            None,
        ).unwrap();

        let details = list_all_branches(path).unwrap();
        let wt_branch = details.iter().find(|b| b.name == "wt-branch").unwrap();
        assert!(wt_branch.is_in_worktree);
    }

    #[test]
    fn test_ahead_behind_no_upstream() {
        let tmp = TempDir::new().unwrap();
        let _repo = init_repo_with_commit(tmp.path());
        let info =
            import_repo(tmp.path().to_string_lossy().to_string()).unwrap();
        for branch in &info.branches {
            assert_eq!(branch.ahead, 0);
            assert_eq!(branch.behind, 0);
        }
    }

    #[test]
    fn test_get_diff_stats() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).unwrap();
        let default_branch = &branches[0].name;

        // Create a feature branch and add a file on it
        create_branch(path.clone(), "feature/stats".to_string(), default_branch.clone()).unwrap();

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

        let branches = list_branches(path.clone()).unwrap();
        let default_branch = &branches[0].name;

        create_branch(
            path.clone(),
            "feature/batch-test".to_string(),
            default_branch.clone(),
        )
        .unwrap();

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

    #[test]
    fn test_enumerate_branches_lightweight() {
        let tmp = TempDir::new().unwrap();
        let repo = init_repo_with_commit(tmp.path());
        let path = tmp.path().to_string_lossy().to_string();

        let branches = list_branches(path.clone()).unwrap();
        let default_branch = &branches[0].name;
        create_branch(path.clone(), "feature/light".to_string(), default_branch.clone()).unwrap();

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
    async fn test_poll_all_workspace_states() {
        let tmp1 = TempDir::new().unwrap();
        let path1 = create_repo_with_feature_branch(tmp1.path());

        let tmp2 = TempDir::new().unwrap();
        let _repo2 = init_repo_with_commit(tmp2.path());
        let path2 = tmp2.path().to_string_lossy().to_string();

        let result = poll_all_workspace_states(vec![path1.clone(), path2.clone()])
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

    #[test]
    fn test_fetch_remote_prunes_deleted_branch() {
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
        let branches_before = list_all_branches(clone_path.clone()).unwrap();
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
        let branches_after = list_all_branches(clone_path).unwrap();
        assert!(!branches_after.iter().any(|b| b.name == "feature/stale"));
    }

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
}
