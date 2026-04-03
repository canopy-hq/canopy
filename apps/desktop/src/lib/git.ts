import { invoke } from '@tauri-apps/api/core';

export interface BranchInfo {
  name: string;
  is_head: boolean;
  ahead: number;
  behind: number;
}

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
}

export interface RepoInfo {
  path: string;
  name: string;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
}

export interface BranchDetail {
  name: string;
  is_head: boolean;
  is_local: boolean;
  is_in_worktree: boolean;
}

export function importRepo(path: string): Promise<RepoInfo> {
  return invoke<RepoInfo>('import_repo', { path });
}

export function listBranches(repoPath: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>('list_branches', { repoPath });
}

export function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  return invoke<WorktreeInfo[]>('list_worktrees', { repoPath });
}

export function listAllBranches(repoPath: string): Promise<BranchDetail[]> {
  return invoke<BranchDetail[]>('list_all_branches', { repoPath });
}

export function createBranch(repoPath: string, name: string, base: string): Promise<BranchInfo> {
  return invoke<BranchInfo>('create_branch', { repoPath, name, base });
}

export function deleteBranch(repoPath: string, name: string): Promise<void> {
  return invoke<void>('delete_branch', { repoPath, name });
}

export function createWorktree(
  repoPath: string,
  name: string,
  path: string,
  baseBranch?: string,
  newBranch?: string,
): Promise<WorktreeInfo> {
  return invoke<WorktreeInfo>('create_worktree', {
    repoPath,
    name,
    path,
    baseBranch: baseBranch ?? null,
    newBranch: newBranch ?? null,
  });
}

export function removeWorktree(repoPath: string, name: string): Promise<void> {
  return invoke<void>('remove_worktree', { repoPath, name });
}
