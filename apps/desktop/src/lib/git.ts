import { getSetting, getSettingCollection } from '@canopy/db';
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

export function cloneRepo(
  projectId: string,
  url: string,
  dest: string,
  branch?: string,
): Promise<RepoInfo> {
  return invoke<RepoInfo>('clone_repo', { projectId, url, dest, branch: branch ?? null });
}

export function checkRemote(url: string): Promise<void> {
  return invoke('check_remote', { url });
}

export function listRemoteBranches(url: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>('list_remote_branches', { url });
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

export interface ProjectPollState {
  head_oid: string;
  branches: BranchInfo[];
  worktree_branches: Record<string, string>;
  diff_stats: Record<string, DiffStat>;
}

export function pollAllProjectStates(
  repoPaths: string[],
): Promise<Record<string, ProjectPollState>> {
  return invoke<Record<string, ProjectPollState>>('poll_all_project_states', { repoPaths });
}

/** Returns the subset of paths that are not valid directories (deleted / unmounted). */
export function checkProjectPaths(paths: string[]): Promise<string[]> {
  return invoke<string[]>('check_project_paths', { paths });
}

/** Normalize a branch/worktree name to a safe identifier (spaces, underscores, slashes → dashes). */
export function sanitizeWorktreeName(name: string): string {
  return name
    .trim()
    .replace(/[\s_]+/g, '-') // spaces/underscores → dash
    .replace(/\/+/g, '/') // collapse multiple slashes
    .replace(/^\/|\/$/g, ''); // strip leading/trailing slashes
}

export const WORKTREE_BASE_DIR_KEY = 'worktreeBaseDir';
export const DEFAULT_WORKTREE_BASE = '~/.canopy/worktrees';

/**
 * Build the worktree disk path from the project's filesystem path and the wt name.
 *
 * The directory basename of the project is used as a prefix so worktrees are
 * clearly associated with their repo regardless of the display name:
 *   projectPath = /repos/mon-projet, wtName = my-feature
 *   → {baseDir}/mon-projet.my-feature
 *
 * Slashes in wtName become subdirectories, with the basename prefix applied to
 * the leaf segment only:
 *   wtName = feat/my-feature → {baseDir}/feat/mon-projet.my-feature
 */
export function buildWorktreePath(projectPath: string, wtName: string): string {
  const baseDir = getSetting<string>(
    getSettingCollection().toArray,
    WORKTREE_BASE_DIR_KEY,
    DEFAULT_WORKTREE_BASE,
  );
  const dirBasename = projectPath.replace(/\/+$/, '').split('/').pop() ?? 'project';
  const parts = wtName.split('/');
  const leaf = parts.pop()!;
  const subdirs = parts;
  const segments = [...subdirs, `${dirBasename}.${leaf}`];
  return `${baseDir}/${segments.join('/')}`;
}
