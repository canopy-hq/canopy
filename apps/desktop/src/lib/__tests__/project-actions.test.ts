import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Project, UiState } from '@canopy/db';

// ── In-memory mock for @canopy/db ────────────────────────────────────────

let _projects: Project[] = [];
let _uiState: UiState = {
  id: 'ui',
  sidebarVisible: false,
  sidebarWidth: 400,
  selectedItemId: null,
  activeTabId: '',
  activeContextId: '',
  contextActiveTabIds: {},
  creatingWorktreeIds: [],
  cloningProjectIds: [],
  cloneProgress: {},
  invalidProjectIds: [],
  justStartedWorktreeId: null,
  pendingClaudeSession: null,
};

const mockSetSetting = vi.fn();

vi.mock('@canopy/db', () => ({
  getProjectCollection: () => ({
    get toArray() {
      return [..._projects];
    },
    insert: (proj: Project) => {
      _projects.push(proj);
    },
    delete: (id: string) => {
      _projects = _projects.filter((p) => p.id !== id);
    },
    update: (id: string, updater: (draft: Project) => void) => {
      const proj = _projects.find((p) => p.id === id);
      if (proj) updater(proj);
    },
  }),
  getTabCollection: () => ({
    get toArray() {
      return [];
    },
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  }),
  uiCollection: {
    update: (_key: string, updater: (draft: UiState) => void) => {
      updater(_uiState);
    },
  },
  getUiState: () => _uiState,
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
  getSettingCollection: () => ({
    get toArray() {
      return [];
    },
  }),
  getSetting: (_arr: unknown[], _key: string, fallback: unknown) => fallback,
}));

// ── Mock Tauri event API ──────────────────────────────────────────────────────

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

// ── Mock git API ─────────────────────────────────────────────────────────────

vi.mock('../git', () => ({ importRepo: vi.fn(), cloneRepo: vi.fn(), listBranches: vi.fn() }));

// ── Mock toast ───────────────────────────────────────────────────────────────

vi.mock('../toast', () => ({ showErrorToast: vi.fn(), showInfoToast: vi.fn() }));

// ── Mock terminal ────────────────────────────────────────────────────────────

vi.mock('@canopy/terminal', () => ({ closePty: vi.fn(), disposeCached: vi.fn() }));

import * as gitApi from '../git';
// Import AFTER mocks are set up
import {
  importRepo,
  importLocalProject,
  startProjectClone,
  switchProjectRelative,
  switchProjectItemRelative,
} from '../project-actions';
import { showInfoToast, showErrorToast } from '../toast';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> & { id: string; path: string }): Project {
  return {
    name: 'my-repo',
    branches: [],
    worktrees: [],
    expanded: true,
    position: 0,
    invalid: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('importRepo', () => {
  beforeEach(() => {
    _projects = [];
    _uiState = {
      id: 'ui',
      sidebarVisible: false,
      sidebarWidth: 400,
      selectedItemId: null,
      activeTabId: '',
      activeContextId: '',
      contextActiveTabIds: {},
      creatingWorktreeIds: [],
      cloningProjectIds: [],
      cloneProgress: {},
      invalidProjectIds: [],
      justStartedWorktreeId: null,
      pendingClaudeSession: null,
    };
    vi.clearAllMocks();
  });

  it('inserts a new project when path is not a duplicate', async () => {
    vi.mocked(gitApi.importRepo).mockResolvedValue({
      path: '/Users/pierre/new-repo',
      name: 'new-repo',
      branches: [],
      worktrees: [],
    });

    await importRepo('/Users/pierre/new-repo');

    expect(_projects).toHaveLength(1);
    expect(_projects[0]!.path).toBe('/Users/pierre/new-repo');
    expect(_projects[0]!.name).toBe('new-repo');
  });

  it('does not insert when path already exists — selects existing + shows info toast', async () => {
    const existing = makeProject({ id: 'proj-1', path: '/Users/pierre/my-repo', name: 'my-repo' });
    _projects = [existing];

    vi.mocked(gitApi.importRepo).mockResolvedValue({
      path: '/Users/pierre/my-repo',
      name: 'my-repo',
      branches: [],
      worktrees: [],
    });

    await importRepo('/Users/pierre/my-repo');

    // No new project inserted
    expect(_projects).toHaveLength(1);

    // Selection not changed (project-level selection was removed)
    expect(_uiState.selectedItemId).toBeNull();

    // Sidebar opened
    expect(_uiState.sidebarVisible).toBe(true);

    // Info toast shown
    expect(showInfoToast).toHaveBeenCalledWith('"my-repo" is already imported');
  });

  it('compares against canonical path from gitApi (not raw input)', async () => {
    const existing = makeProject({ id: 'proj-1', path: '/Users/pierre/my-repo', name: 'my-repo' });
    _projects = [existing];

    // Simulate user selecting path with trailing slash — gitApi returns canonical
    vi.mocked(gitApi.importRepo).mockResolvedValue({
      path: '/Users/pierre/my-repo',
      name: 'my-repo',
      branches: [],
      worktrees: [],
    });

    await importRepo('/Users/pierre/my-repo/');

    // Should detect duplicate via canonical info.path
    expect(_projects).toHaveLength(1);
    expect(showInfoToast).toHaveBeenCalledWith('"my-repo" is already imported');
  });
});

// ── importLocalProject ──────────────────────────────────────────────────────

describe('importLocalProject', () => {
  const nav = vi.fn();
  const branch = { name: 'main', is_head: true, ahead: 0, behind: 0 };

  beforeEach(() => {
    _projects = [];
    nav.mockClear();
  });

  it('inserts a new project with the chosen branch', () => {
    importLocalProject('/repos/foo', 'foo', branch, nav);
    expect(_projects).toHaveLength(1);
    expect(_projects[0]!.name).toBe('foo');
    expect(_projects[0]!.branches).toEqual([branch]);
    expect(nav).toHaveBeenCalled();
  });

  it('shows info toast when path is already imported', () => {
    _projects = [makeProject({ id: 'x', path: '/repos/foo', name: 'foo' })];
    importLocalProject('/repos/foo', 'foo', branch, nav);
    expect(_projects).toHaveLength(1);
    expect(showInfoToast).toHaveBeenCalledWith('"foo" is already imported');
  });

  it('falls back to directory name when name is empty', () => {
    importLocalProject('/repos/bar', '', branch, nav);
    expect(_projects[0]!.name).toBe('bar');
  });
});

// ── startProjectClone ──────────────────────────────────────────────────────

describe('startProjectClone', () => {
  const nav = vi.fn();

  beforeEach(() => {
    _projects = [];
    _uiState.cloningProjectIds = [];
    nav.mockClear();
    vi.clearAllMocks();
  });

  it('optimistically inserts the project and marks it as cloning', () => {
    vi.mocked(gitApi.cloneRepo).mockReturnValue(new Promise(() => {})); // never resolves
    startProjectClone('https://github.com/o/r.git', '/tmp/dest', 'r', 'main', nav);
    expect(_projects).toHaveLength(1);
    expect(_projects[0]!.name).toBe('r');
    expect(_projects[0]!.branches).toEqual([]);
    expect(_uiState.cloningProjectIds).toHaveLength(1);
  });

  it('updates project on successful clone', async () => {
    const headBranch = { name: 'main', is_head: true, ahead: 0, behind: 0 };
    vi.mocked(gitApi.cloneRepo).mockResolvedValue({
      path: '/tmp/dest/r',
      name: 'r',
      branches: [headBranch],
      worktrees: [],
    });

    startProjectClone('https://github.com/o/r.git', '/tmp/dest', 'r', 'main', nav);
    await vi.waitFor(() => expect(_uiState.cloningProjectIds).toHaveLength(0));

    expect(_projects).toHaveLength(1);
    expect(_projects[0]!.branches).toEqual([headBranch]);
  });

  it('removes project and shows error toast on clone failure', async () => {
    vi.mocked(gitApi.cloneRepo).mockRejectedValue(new Error('clone failed'));
    startProjectClone('https://github.com/o/r.git', '/tmp/dest', 'r', 'main', nav);
    await vi.waitFor(() => expect(_uiState.cloningProjectIds).toHaveLength(0));

    expect(_projects).toHaveLength(0);
    expect(showErrorToast).toHaveBeenCalledWith('Clone failed', 'Error: clone failed');
  });

  it('adds SSH hint when error mentions auth', async () => {
    vi.mocked(gitApi.cloneRepo).mockRejectedValue(new Error('authentication failed'));
    startProjectClone('git@github.com:o/r.git', '/tmp/dest', 'r', 'main', nav);
    await vi.waitFor(() => expect(_uiState.cloningProjectIds).toHaveLength(0));

    expect(showErrorToast).toHaveBeenCalledWith(
      'Clone failed',
      expect.stringContaining('SSH key setup'),
    );
  });
});

// ── Navigation helpers ────────────────────────────────────────────────────────

const mockNavigate = vi.fn();

function makeBranch(name: string, is_head = false) {
  return { name, is_head, ahead: 0, behind: 0 };
}

function resetNav() {
  mockNavigate.mockClear();
  _projects = [];
  _uiState = {
    id: 'ui',
    sidebarVisible: false,
    sidebarWidth: 400,
    selectedItemId: null,
    activeTabId: '',
    activeContextId: '',
    contextActiveTabIds: {},
    creatingWorktreeIds: [],
    cloningProjectIds: [],
    cloneProgress: {},
    invalidProjectIds: [],
    justStartedWorktreeId: null,
    pendingClaudeSession: null,
  };
}

describe('switchProjectRelative', () => {
  beforeEach(() => {
    resetNav();
    _projects = [
      makeProject({ id: 'p1', path: '/p1', position: 0, branches: [makeBranch('main', true)] }),
      makeProject({ id: 'p2', path: '/p2', position: 1, branches: [makeBranch('dev', true)] }),
      makeProject({ id: 'p3', path: '/p3', position: 2, branches: [makeBranch('feat', true)] }),
    ];
  });

  it('moves to the next project', () => {
    _uiState.activeContextId = 'p1-branch-main';
    switchProjectRelative('next', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p2-branch-dev' } }),
    );
  });

  it('moves to the previous project', () => {
    _uiState.activeContextId = 'p2-branch-dev';
    switchProjectRelative('prev', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p1-branch-main' } }),
    );
  });

  it('wraps from last to first on next', () => {
    _uiState.activeContextId = 'p3-branch-feat';
    switchProjectRelative('next', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p1-branch-main' } }),
    );
  });

  it('wraps from first to last on prev', () => {
    _uiState.activeContextId = 'p1-branch-main';
    switchProjectRelative('prev', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p3-branch-feat' } }),
    );
  });

  it('does not crash when activeContextId is not found (-1 edge case)', () => {
    _uiState.activeContextId = 'unknown-ctx';
    expect(() => switchProjectRelative('prev', mockNavigate)).not.toThrow();
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('is a no-op when there are no projects', () => {
    _projects = [];
    _uiState.activeContextId = 'p1-branch-main';
    switchProjectRelative('next', mockNavigate);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('switchProjectItemRelative', () => {
  beforeEach(() => {
    resetNav();
    _projects = [
      makeProject({
        id: 'p1',
        path: '/p1',
        position: 0,
        branches: [makeBranch('main', true), makeBranch('dev')],
        worktrees: [{ name: 'feat', path: '/p1-feat', branch: 'feat' }],
      }),
    ];
    _uiState.activeContextId = 'p1-branch-main';
  });

  it('moves to the next item (branch → branch)', () => {
    switchProjectItemRelative('next', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p1-branch-dev' } }),
    );
  });

  it('moves to the next item (branch → worktree)', () => {
    _uiState.activeContextId = 'p1-branch-dev';
    switchProjectItemRelative('next', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p1-wt-feat' } }),
    );
  });

  it('moves to the previous item', () => {
    _uiState.activeContextId = 'p1-branch-dev';
    switchProjectItemRelative('prev', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p1-branch-main' } }),
    );
  });

  it('wraps from last to first on next', () => {
    _uiState.activeContextId = 'p1-wt-feat';
    switchProjectItemRelative('next', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p1-branch-main' } }),
    );
  });

  it('wraps from first to last on prev', () => {
    _uiState.activeContextId = 'p1-branch-main';
    switchProjectItemRelative('prev', mockNavigate);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ params: { projectId: 'p1-wt-feat' } }),
    );
  });

  it('does not crash when activeContextId is not in items (-1 edge case)', () => {
    _uiState.activeContextId = 'p1'; // project root, not in items list
    expect(() => switchProjectItemRelative('prev', mockNavigate)).not.toThrow();
    expect(mockNavigate).toHaveBeenCalled();
  });
});
