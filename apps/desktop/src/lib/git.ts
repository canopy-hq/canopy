import { getSetting, getSettingCollection } from '@superagent/db';
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

export interface DiffStat {
  additions: number;
  deletions: number;
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

export function fetchRemote(repoPath: string): Promise<void> {
  return invoke<void>('fetch_remote', { repoPath });
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

export function getDiffStats(repoPath: string): Promise<Record<string, DiffStat>> {
  return invoke<Record<string, DiffStat>>('get_diff_stats', { repoPath });
}

export function getAllDiffStats(
  repoPaths: string[],
): Promise<Record<string, Record<string, DiffStat>>> {
  return invoke<Record<string, Record<string, DiffStat>>>('get_all_diff_stats', { repoPaths });
}

export interface WorkspacePollState {
  head_oid: string;
  branches: BranchInfo[];
  worktree_branches: Record<string, string>;
  diff_stats: Record<string, DiffStat>;
}

export function pollAllWorkspaceStates(
  repoPaths: string[],
): Promise<Record<string, WorkspacePollState>> {
  return invoke<Record<string, WorkspacePollState>>('poll_all_workspace_states', { repoPaths });
}

/** Normalize a branch/worktree name to a safe identifier (spaces, underscores, slashes → dashes). */
export function sanitizeWorktreeName(name: string): string {
  return name.trim().replace(/[\s_/]+/g, '-');
}

export const WORKTREE_BASE_DIR_KEY = 'worktreeBaseDir';
const DEFAULT_WORKTREE_BASE = '~/.superagent/worktrees';

/** Build the worktree disk path, using the user-configured base dir or the default. */
export function buildWorktreePath(workspaceName: string, wtName: string): string {
  const baseDir = getSetting<string>(
    getSettingCollection().toArray,
    WORKTREE_BASE_DIR_KEY,
    DEFAULT_WORKTREE_BASE,
  );
  return `${baseDir}/${workspaceName}-${wtName}`;
}
