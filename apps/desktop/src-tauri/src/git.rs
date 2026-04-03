use git2::{BranchType, Repository, WorktreeAddOptions, WorktreePruneOptions};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;

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

fn enumerate_branches(repo: &Repository) -> Result<Vec<BranchInfo>, String> {
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

        let (ahead, behind) = match branch.upstream() {
            Ok(upstream) => {
                let local_oid = branch.get().target().unwrap();
                let upstream_oid = upstream.get().target().unwrap();
                repo.graph_ahead_behind(local_oid, upstream_oid)
                    .unwrap_or((0, 0))
            }
            Err(_) => (0, 0), // No upstream tracking
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
    let all_branches = enumerate_branches(&repo)?;
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
    enumerate_branches(&repo)
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
    Some(DiffStat {
        additions: stats.insertions(),
        deletions: stats.deletions(),
    })
}

#[tauri::command]
pub fn get_diff_stats(repo_path: String) -> Result<HashMap<String, DiffStat>, String> {
    let repo = Repository::open(&repo_path).map_err(|e| e.to_string())?;

    let head_ref = repo.head().map_err(|e| e.to_string())?;
    let head_commit = head_ref.peel_to_commit().map_err(|e| e.to_string())?;
    let base_tree = head_commit.tree().map_err(|e| e.to_string())?;
    let head_name = head_ref.shorthand().unwrap_or("HEAD").to_string();

    let mut stats_map = HashMap::new();

    // For HEAD branch: diff working tree (staged + unstaged) against HEAD tree
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
                if let Some(stat) = diff_stat_for_tree(&repo, &base_tree, &branch_tree) {
                    stats_map.insert(name, stat);
                }
            }
        }
    }

    // Worktree HEADs that may not be in the local branch list
    let wt_names = repo.worktrees().map_err(|e| e.to_string())?;
    for wt_name in wt_names.iter() {
        let wt_name = match wt_name {
            Some(n) => n,
            None => continue,
        };
        let wt = match repo.find_worktree(wt_name) {
            Ok(wt) if wt.validate().is_ok() => wt,
            _ => continue,
        };
        if let Some(branch_name) = resolve_worktree_branch(wt.path()) {
            if stats_map.contains_key(&branch_name) {
                continue;
            }
            // Resolve via main repo handle — no need to open a second Repository
            if let Ok(branch) = repo.find_branch(&branch_name, BranchType::Local) {
                if let Ok(commit) = branch.get().peel_to_commit() {
                    if let Ok(wt_tree) = commit.tree() {
                        if let Some(stat) = diff_stat_for_tree(&repo, &base_tree, &wt_tree) {
                            stats_map.insert(branch_name, stat);
                        }
                    }
                }
            }
        }
    }

    Ok(stats_map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
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
        let repo = init_repo_with_commit(tmp.path());
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

        let stats = get_diff_stats(path).unwrap();
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
        let stats = get_diff_stats(path).unwrap();
        assert!(stats.is_empty());
    }
}
