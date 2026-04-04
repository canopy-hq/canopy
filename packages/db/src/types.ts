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

// ── Workspace ────────────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  path: string;
  name: string;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  expanded: boolean;
  position: number;
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
  workspaceItemId: string;
  paneRoot: PaneNode;
  focusedPaneId: string | null;
  position: number;
}

// ── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  id: string;
  paneId: string;
  tabId: string;
  workspaceId: string | null;
  cwd: string;
  shell: string;
}

// ── Settings ─────────────────────────────────────────────────────────────────

export interface Setting {
  key: string;
  value: string;
}
