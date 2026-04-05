import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Workspace, UiState } from '@superagent/db';

// ── In-memory mock for @superagent/db ────────────────────────────────────────

let _workspaces: Workspace[] = [];
let _uiState: UiState = {
  id: 'ui',
  sidebarVisible: false,
  sidebarWidth: 400,
  selectedItemId: null,
  activeTabId: '',
  activeContextId: '',
  contextActiveTabIds: {},
  creatingWorktreeIds: [],
};

const mockSetSetting = vi.fn();

vi.mock('@superagent/db', () => ({
  getWorkspaceCollection: () => ({
    get toArray() {
      return [..._workspaces];
    },
    insert: (ws: Workspace) => {
      _workspaces.push(ws);
    },
    delete: (id: string) => {
      _workspaces = _workspaces.filter((w) => w.id !== id);
    },
    update: (id: string, updater: (draft: Workspace) => void) => {
      const ws = _workspaces.find((w) => w.id === id);
      if (ws) updater(ws);
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
}));

// ── Mock git API ─────────────────────────────────────────────────────────────

vi.mock('../git', () => ({ importRepo: vi.fn() }));

// ── Mock toast ───────────────────────────────────────────────────────────────

vi.mock('../toast', () => ({ showErrorToast: vi.fn(), showInfoToast: vi.fn() }));

// ── Mock terminal ────────────────────────────────────────────────────────────

vi.mock('@superagent/terminal', () => ({ closePty: vi.fn(), disposeCached: vi.fn() }));

import * as gitApi from '../git';
import { showInfoToast } from '../toast';
// Import AFTER mocks are set up
import { importRepo } from '../workspace-actions';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Partial<Workspace> & { id: string; path: string }): Workspace {
  return {
    name: 'my-repo',
    branches: [],
    worktrees: [],
    expanded: true,
    position: 0,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('importRepo', () => {
  beforeEach(() => {
    _workspaces = [];
    _uiState = {
      id: 'ui',
      sidebarVisible: false,
      sidebarWidth: 400,
      selectedItemId: null,
      activeTabId: '',
      activeContextId: '',
      contextActiveTabIds: {},
      creatingWorktreeIds: [],
    };
    vi.clearAllMocks();
  });

  it('inserts a new workspace when path is not a duplicate', async () => {
    vi.mocked(gitApi.importRepo).mockResolvedValue({
      path: '/Users/pierre/new-repo',
      name: 'new-repo',
      branches: [],
      worktrees: [],
    });

    await importRepo('/Users/pierre/new-repo');

    expect(_workspaces).toHaveLength(1);
    expect(_workspaces[0]!.path).toBe('/Users/pierre/new-repo');
    expect(_workspaces[0]!.name).toBe('new-repo');
  });

  it('does not insert when path already exists — selects existing + shows info toast', async () => {
    const existing = makeWorkspace({ id: 'ws-1', path: '/Users/pierre/my-repo', name: 'my-repo' });
    _workspaces = [existing];

    vi.mocked(gitApi.importRepo).mockResolvedValue({
      path: '/Users/pierre/my-repo',
      name: 'my-repo',
      branches: [],
      worktrees: [],
    });

    await importRepo('/Users/pierre/my-repo');

    // No new workspace inserted
    expect(_workspaces).toHaveLength(1);

    // Selection not changed (workspace-level selection was removed)
    expect(_uiState.selectedItemId).toBeNull();

    // Sidebar opened
    expect(_uiState.sidebarVisible).toBe(true);

    // Info toast shown
    expect(showInfoToast).toHaveBeenCalledWith('"my-repo" is already imported');
  });

  it('compares against canonical path from gitApi (not raw input)', async () => {
    const existing = makeWorkspace({ id: 'ws-1', path: '/Users/pierre/my-repo', name: 'my-repo' });
    _workspaces = [existing];

    // Simulate user selecting path with trailing slash — gitApi returns canonical
    vi.mocked(gitApi.importRepo).mockResolvedValue({
      path: '/Users/pierre/my-repo',
      name: 'my-repo',
      branches: [],
      worktrees: [],
    });

    await importRepo('/Users/pierre/my-repo/');

    // Should detect duplicate via canonical info.path
    expect(_workspaces).toHaveLength(1);
    expect(showInfoToast).toHaveBeenCalledWith('"my-repo" is already imported');
  });
});
