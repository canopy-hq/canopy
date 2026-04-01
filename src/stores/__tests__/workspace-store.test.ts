import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RepoInfo } from '../../lib/git';

// Mock git API
vi.mock('../../lib/git', () => ({
  importRepo: vi.fn(),
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

// Mock toast
vi.mock('../../lib/toast', () => ({
  showErrorToast: vi.fn(),
}));

// Must import after mocks
import { useWorkspaceStore } from '../workspace-store';
import * as gitApi from '../../lib/git';

const mockImportRepo = vi.mocked(gitApi.importRepo);

function resetStore() {
  useWorkspaceStore.setState({
    workspaces: [],
    sidebarVisible: false,
    sidebarWidth: 230,
    selectedItemId: null,
  });
}

describe('workspace-store', () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it('has correct default state', () => {
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual([]);
    expect(state.sidebarVisible).toBe(false);
    expect(state.sidebarWidth).toBe(230);
    expect(state.selectedItemId).toBeNull();
  });

  it('toggleSidebar flips sidebarVisible', () => {
    const { toggleSidebar } = useWorkspaceStore.getState();
    expect(useWorkspaceStore.getState().sidebarVisible).toBe(false);
    toggleSidebar();
    expect(useWorkspaceStore.getState().sidebarVisible).toBe(true);
    toggleSidebar();
    expect(useWorkspaceStore.getState().sidebarVisible).toBe(false);
  });

  it('setSidebarWidth clamps to 180 minimum', () => {
    const { setSidebarWidth } = useWorkspaceStore.getState();
    setSidebarWidth(100);
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(180);
  });

  it('setSidebarWidth clamps to 400 maximum', () => {
    const { setSidebarWidth } = useWorkspaceStore.getState();
    setSidebarWidth(500);
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(400);
  });

  it('setSidebarWidth accepts values in range', () => {
    const { setSidebarWidth } = useWorkspaceStore.getState();
    setSidebarWidth(300);
    expect(useWorkspaceStore.getState().sidebarWidth).toBe(300);
  });

  it('importRepo adds workspace with expanded: true', async () => {
    const mockInfo: RepoInfo = {
      path: '/repos/my-project',
      name: 'my-project',
      branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
      worktrees: [],
    };
    mockImportRepo.mockResolvedValueOnce(mockInfo);

    await useWorkspaceStore.getState().importRepo('/repos/my-project');
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBe('my-project');
    expect(state.workspaces[0].expanded).toBe(true);
    expect(state.workspaces[0].id).toBeTruthy();
  });

  it('importRepo sets sidebarVisible to true', async () => {
    const mockInfo: RepoInfo = {
      path: '/repos/test',
      name: 'test',
      branches: [],
      worktrees: [],
    };
    mockImportRepo.mockResolvedValueOnce(mockInfo);

    expect(useWorkspaceStore.getState().sidebarVisible).toBe(false);
    await useWorkspaceStore.getState().importRepo('/repos/test');
    expect(useWorkspaceStore.getState().sidebarVisible).toBe(true);
  });

  it('removeRepo removes workspace from array', async () => {
    const mockInfo: RepoInfo = {
      path: '/repos/test',
      name: 'test',
      branches: [],
      worktrees: [],
    };
    mockImportRepo.mockResolvedValueOnce(mockInfo);
    await useWorkspaceStore.getState().importRepo('/repos/test');

    const id = useWorkspaceStore.getState().workspaces[0].id;
    useWorkspaceStore.getState().removeRepo(id);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);
  });

  it('toggleExpanded flips expanded state', async () => {
    const mockInfo: RepoInfo = {
      path: '/repos/test',
      name: 'test',
      branches: [],
      worktrees: [],
    };
    mockImportRepo.mockResolvedValueOnce(mockInfo);
    await useWorkspaceStore.getState().importRepo('/repos/test');

    const id = useWorkspaceStore.getState().workspaces[0].id;
    expect(useWorkspaceStore.getState().workspaces[0].expanded).toBe(true);

    useWorkspaceStore.getState().toggleExpanded(id);
    expect(useWorkspaceStore.getState().workspaces[0].expanded).toBe(false);

    useWorkspaceStore.getState().toggleExpanded(id);
    expect(useWorkspaceStore.getState().workspaces[0].expanded).toBe(true);
  });
});
