import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BranchInfo, WorktreeInfo } from '../lib/git';
import * as gitApi from '../lib/git';
import { showErrorToast } from '../lib/toast';
import { useTabsStore } from './tabs-store';

export interface Workspace {
  id: string;
  path: string;
  name: string;
  branches: BranchInfo[];
  worktrees: WorktreeInfo[];
  expanded: boolean;
}

interface WorkspaceState {
  workspaces: Workspace[];
  sidebarVisible: boolean;
  sidebarWidth: number;
  selectedItemId: string | null;

  // Sidebar
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;

  // Workspace CRUD
  importRepo: (path: string) => Promise<void>;
  removeRepo: (id: string) => void;
  refreshRepo: (id: string) => Promise<void>;
  toggleExpanded: (id: string) => void;
  setSelectedItem: (id: string | null) => void;
  selectWorkspaceItem: (itemId: string | null, itemLabel?: string) => void;

  // Git operations
  createBranch: (workspaceId: string, name: string, base: string) => Promise<void>;
  deleteBranch: (workspaceId: string, name: string) => Promise<void>;
  createWorktree: (
    workspaceId: string,
    name: string,
    path: string,
    baseBranch?: string,
  ) => Promise<void>;
  removeWorktree: (workspaceId: string, name: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  immer((set, get) => ({
    workspaces: [],
    sidebarVisible: false,
    sidebarWidth: 230,
    selectedItemId: null,

    toggleSidebar: () =>
      set((state) => {
        state.sidebarVisible = !state.sidebarVisible;
      }),

    setSidebarWidth: (width: number) =>
      set((state) => {
        state.sidebarWidth = Math.max(180, Math.min(400, width));
      }),

    importRepo: async (path: string) => {
      try {
        const info = await gitApi.importRepo(path);
        set((state) => {
          state.workspaces.push({
            id: crypto.randomUUID(),
            path: info.path,
            name: info.name,
            branches: info.branches,
            worktrees: info.worktrees,
            expanded: true,
          });
          state.sidebarVisible = true;
        });
      } catch (err) {
        showErrorToast('Import failed', String(err));
      }
    },

    removeRepo: (id: string) =>
      set((state) => {
        state.workspaces = state.workspaces.filter((w) => w.id !== id);
      }),

    refreshRepo: async (id: string) => {
      const ws = get().workspaces.find((w) => w.id === id);
      if (!ws) return;
      try {
        const info = await gitApi.importRepo(ws.path);
        set((state) => {
          const workspace = state.workspaces.find((w) => w.id === id);
          if (workspace) {
            workspace.branches = info.branches;
            workspace.worktrees = info.worktrees;
          }
        });
      } catch (err) {
        showErrorToast('Refresh failed', String(err));
      }
    },

    toggleExpanded: (id: string) =>
      set((state) => {
        const ws = state.workspaces.find((w) => w.id === id);
        if (ws) ws.expanded = !ws.expanded;
      }),

    setSelectedItem: (id: string | null) =>
      set((state) => {
        state.selectedItemId = id;
      }),

    selectWorkspaceItem: (itemId: string | null, itemLabel?: string) => {
      set((state) => {
        state.selectedItemId = itemId;
      });
      if (itemId !== null && itemLabel) {
        useTabsStore.getState().setActiveContext(itemId, itemLabel);
      } else if (itemId === null) {
        useTabsStore.getState().setActiveContext('');
      }
    },

    createBranch: async (workspaceId: string, name: string, base: string) => {
      const ws = get().workspaces.find((w) => w.id === workspaceId);
      if (!ws) return;
      try {
        await gitApi.createBranch(ws.path, name, base);
        await get().refreshRepo(workspaceId);
      } catch (err) {
        showErrorToast('Create branch failed', String(err));
      }
    },

    deleteBranch: async (workspaceId: string, name: string) => {
      const ws = get().workspaces.find((w) => w.id === workspaceId);
      if (!ws) return;
      try {
        await gitApi.deleteBranch(ws.path, name);
        await get().refreshRepo(workspaceId);
      } catch (err) {
        showErrorToast('Delete branch failed', String(err));
      }
    },

    createWorktree: async (
      workspaceId: string,
      name: string,
      path: string,
      baseBranch?: string,
    ) => {
      const ws = get().workspaces.find((w) => w.id === workspaceId);
      if (!ws) return;
      try {
        await gitApi.createWorktree(ws.path, name, path, baseBranch);
        await get().refreshRepo(workspaceId);
      } catch (err) {
        showErrorToast('Create worktree failed', String(err));
      }
    },

    removeWorktree: async (workspaceId: string, name: string) => {
      const ws = get().workspaces.find((w) => w.id === workspaceId);
      if (!ws) return;
      try {
        await gitApi.removeWorktree(ws.path, name);
        await get().refreshRepo(workspaceId);
      } catch (err) {
        showErrorToast('Remove worktree failed', String(err));
      }
    },
  })),
);
