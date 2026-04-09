// Domain types shared between packages/db and apps/desktop.
// Must stay in sync with lib/git.ts in the desktop app.

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
  label?: string;
}

// ── Group ────────────────────────────────────────────────────────────────────

export interface Group {
  id: string;
  name: string;
  position: number;
  collapsed: boolean;
}

// ── Project ──────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  path: string;
  name: string;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  expanded: boolean;
  position: number;
  color?: string | null;
  groupId?: string | null;
}

// ── Tab / Pane ───────────────────────────────────────────────────────────────

export type SplitDirection = 'horizontal' | 'vertical';

export interface LeafNode {
  type: 'leaf';
  id: string;
  ptyId: number;
}

export interface BranchNode {
  type: 'branch';
  id: string;
  direction: SplitDirection;
  ratios: number[];
  children: PaneNode[];
}

export type PaneNode = LeafNode | BranchNode;

export interface Tab {
  id: string;
  label: string;
  labelIsManual: boolean;
  icon?: string;
  projectItemId: string;
  paneRoot: PaneNode;
  focusedPaneId: string | null;
  position: number;
}

// ── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  paneId: string;
  tabId: string;
  projectId: string | null;
  cwd: string;
  shell: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface Setting {
  key: string;
  value: string;
}
