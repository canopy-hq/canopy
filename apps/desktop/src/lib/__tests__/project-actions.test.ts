import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Project, UiState } from '@superagent/db';

// ── In-memory mock for @superagent/db ────────────────────────────────────────

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
  justStartedWorktreeId: null,
  pendingClaudeSession: null,
};

const mockSetSetting = vi.fn();

vi.mock('@superagent/db', () => ({
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
}));

// ── Mock git API ─────────────────────────────────────────────────────────────

vi.mock('../git', () => ({ importRepo: vi.fn() }));

// ── Mock toast ───────────────────────────────────────────────────────────────

vi.mock('../toast', () => ({ showErrorToast: vi.fn(), showInfoToast: vi.fn() }));

// ── Mock terminal ────────────────────────────────────────────────────────────

vi.mock('@superagent/terminal', () => ({ closePty: vi.fn(), disposeCached: vi.fn() }));

import * as gitApi from '../git';
// Import AFTER mocks are set up
import { importRepo } from '../project-actions';
import { showInfoToast } from '../toast';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(overrides: Partial<Project> & { id: string; path: string }): Project {
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
