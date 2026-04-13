import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Tab, Project } from '@canopy/db';
import type { UiState } from '@canopy/db';

// ── In-memory mock for @canopy/db ────────────────────────────────────────

let _tabs: Tab[] = [];
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
  navHistory: [],
  navIndex: -1,
};

const _projects: Project[] = [
  {
    id: 'ws-1',
    path: '/repos/my-project',
    name: 'my-project',
    branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
    worktrees: [{ name: 'feature-x', path: '/worktrees/feature-x', branch: 'feature-x' }],
    expanded: true,
    position: 0,
    invalid: false,
  },
];

const mockSetSetting = vi.fn();
const mockRouterNavigate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@canopy/db', () => ({
  getProjectCollection: () => ({
    get toArray() {
      return [..._projects];
    },
  }),
  getTabCollection: () => ({
    get toArray() {
      return [..._tabs];
    },
    insert: (tab: Tab) => {
      _tabs.push(tab);
    },
    delete: (id: string) => {
      _tabs = _tabs.filter((t) => t.id !== id);
    },
    update: (id: string, updater: (draft: Tab) => void) => {
      const tab = _tabs.find((t) => t.id === id);
      if (tab) updater(tab);
    },
  }),
  getSettingCollection: () => ({
    get toArray() {
      return [];
    },
  }),
  getSetting: (_arr: unknown[], _key: string, fallback: unknown) => fallback,
  uiCollection: {
    update: (_key: string, updater: (draft: UiState) => void) => {
      updater(_uiState);
    },
  },
  getUiState: () => _uiState,
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
  insertTab: (tab: Tab) => {
    _tabs.push(tab);
  },
  deleteTab: (tabId: string) => {
    _tabs = _tabs.filter((t) => t.id !== tabId);
  },
  syncNavStateToLocalStorage: vi.fn(),
}));

vi.mock('../../router', () => ({
  router: { navigate: mockRouterNavigate, latestLocation: { pathname: '' } },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

vi.mock('@canopy/terminal', () => ({
  spawnTerminal: vi.fn().mockResolvedValue({ ptyId: 42 }),
  writeToPty: vi.fn().mockResolvedValue(undefined),
  closePty: vi.fn().mockResolvedValue(undefined),
  closePtysForPanes: vi.fn().mockResolvedValue(undefined),
  disposeCached: vi.fn(),
  initTerminalPool: vi.fn(),
}));

// Import AFTER mock is set up
import {
  closeTab,
  activateTabFromRoute,
  setPtyIdInTab,
  addTab,
  splitPane,
  resolveProjectItemCwd,
  addClaudeCodeTab,
} from '../tab-actions';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<Tab> & { id: string; projectItemId: string }): Tab {
  return {
    label: 'Terminal',
    labelIsManual: false,
    paneRoot: { type: 'leaf', id: 'pane-1', ptyId: -1 },
    focusedPaneId: 'pane-1',
    position: 0,
    ...overrides,
  };
}

function findCwdSettingCall() {
  return mockSetSetting.mock.calls.find(
    ([key]) => typeof key === 'string' && key.startsWith('cwd:'),
  );
}

function resetState() {
  _tabs = [];
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
    navHistory: [],
    navIndex: -1,
  };
  mockSetSetting.mockClear();
  mockRouterNavigate.mockClear();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('activateTabFromRoute', () => {
  beforeEach(resetState);

  it('sets activeTabId and activeContextId in the store', () => {
    activateTabFromRoute('ctx-a', 'tab-1');

    expect(_uiState.activeContextId).toBe('ctx-a');
    expect(_uiState.activeTabId).toBe('tab-1');
  });

  it('updates active context and tab when switching contexts', () => {
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-a';

    activateTabFromRoute('ctx-b', 'tab-b');

    expect(_uiState.activeContextId).toBe('ctx-b');
    expect(_uiState.activeTabId).toBe('tab-b');
    expect(_uiState.contextActiveTabIds['ctx-b']).toBe('tab-b');
  });

  it('records the new context tab in contextActiveTabIds', () => {
    activateTabFromRoute('ctx-a', 'tab-1');

    expect(_uiState.contextActiveTabIds['ctx-a']).toBe('tab-1');
  });

  it('sets selectedItemId to the contextId', () => {
    activateTabFromRoute('ctx-a', 'tab-1');

    expect(_uiState.selectedItemId).toBe('ctx-a');
  });
});

describe('closeTab', () => {
  beforeEach(resetState);

  it('navigates to project root when closing the last tab', () => {
    const tab = makeTab({ id: 'tab-1', projectItemId: 'ctx-a' });
    _tabs.push(tab);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-1';

    closeTab('tab-1');

    expect(_tabs).toHaveLength(0);
    expect(mockRouterNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/projects/$projectId' }),
    );
  });

  it('cleans up contextActiveTabIds when closing the last tab', () => {
    const tab = makeTab({ id: 'tab-1', projectItemId: 'ctx-a' });
    _tabs.push(tab);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-1';
    _uiState.contextActiveTabIds = { 'ctx-a': 'tab-1', 'ctx-b': 'tab-other' };

    closeTab('tab-1');

    expect(_uiState.contextActiveTabIds).not.toHaveProperty('ctx-a');
    expect(_uiState.contextActiveTabIds).toHaveProperty('ctx-b', 'tab-other');
  });

  it('navigates to the tab to the left when closing the rightmost active tab', () => {
    const tab1 = makeTab({ id: 'tab-1', projectItemId: 'ctx-a', position: 0 });
    const tab2 = makeTab({ id: 'tab-2', projectItemId: 'ctx-a', position: 1 });
    const tab3 = makeTab({ id: 'tab-3', projectItemId: 'ctx-a', position: 2 });
    _tabs.push(tab1, tab2, tab3);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-3';

    closeTab('tab-3');

    expect(_tabs).toHaveLength(2);
    expect(mockRouterNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/projects/$projectId/tabs/$tabId',
        params: expect.objectContaining({ tabId: 'tab-2' }),
      }),
    );
  });

  it('navigates to the tab to the right when closing the first active tab', () => {
    const tab1 = makeTab({ id: 'tab-1', projectItemId: 'ctx-a', position: 0 });
    const tab2 = makeTab({ id: 'tab-2', projectItemId: 'ctx-a', position: 1 });
    _tabs.push(tab1, tab2);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-1';

    closeTab('tab-1');

    expect(_tabs).toHaveLength(1);
    expect(mockRouterNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '/projects/$projectId/tabs/$tabId',
        params: expect.objectContaining({ tabId: 'tab-2' }),
      }),
    );
  });

  it('does not navigate when closing a non-active tab', () => {
    const tab1 = makeTab({ id: 'tab-1', projectItemId: 'ctx-a', position: 0 });
    const tab2 = makeTab({ id: 'tab-2', projectItemId: 'ctx-a', position: 1 });
    _tabs.push(tab1, tab2);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-1';

    closeTab('tab-2');

    expect(_tabs).toHaveLength(1);
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });
});

describe('setPtyIdInTab', () => {
  beforeEach(resetState);

  it('sets ptyId on a single-leaf root tab', () => {
    const tab = makeTab({ id: 'tab-1', projectItemId: 'ctx-a' });
    _tabs.push(tab);

    setPtyIdInTab('tab-1', 'pane-1', 999);

    const updated = _tabs.find((t) => t.id === 'tab-1')!;
    expect(updated.paneRoot.type).toBe('leaf');
    expect((updated.paneRoot as { ptyId: number }).ptyId).toBe(999);
  });

  it('sets ptyId on the correct leaf in a split (branch) tab', () => {
    const tab = makeTab({
      id: 'tab-1',
      projectItemId: 'ctx-a',
      paneRoot: {
        type: 'branch',
        id: 'branch-1',
        direction: 'horizontal',
        ratios: [0.5, 0.5],
        children: [
          { type: 'leaf', id: 'pane-left', ptyId: -1 },
          { type: 'leaf', id: 'pane-right', ptyId: -1 },
        ],
      },
    });
    _tabs.push(tab);

    setPtyIdInTab('tab-1', 'pane-right', 42);

    const updated = _tabs.find((t) => t.id === 'tab-1')!;
    const branch = updated.paneRoot as { children: { id: string; ptyId: number }[] };
    expect(branch.children[0]!.ptyId).toBe(-1);
    expect(branch.children[1]!.ptyId).toBe(42);
  });

  it('is a no-op for an unknown tabId', () => {
    const tab = makeTab({ id: 'tab-1', projectItemId: 'ctx-a' });
    _tabs.push(tab);

    setPtyIdInTab('does-not-exist', 'pane-1', 99);

    const unchanged = _tabs.find((t) => t.id === 'tab-1')!;
    expect((unchanged.paneRoot as { ptyId: number }).ptyId).toBe(-1);
  });

  it('is a no-op for an unknown paneId within a valid tab', () => {
    const tab = makeTab({ id: 'tab-1', projectItemId: 'ctx-a' });
    _tabs.push(tab);

    setPtyIdInTab('tab-1', 'does-not-exist', 77);

    const unchanged = _tabs.find((t) => t.id === 'tab-1')!;
    expect((unchanged.paneRoot as { ptyId: number }).ptyId).toBe(-1);
  });

  it('does not affect sibling tabs', () => {
    const tab1 = makeTab({ id: 'tab-1', projectItemId: 'ctx-a' });
    const tab2 = makeTab({
      id: 'tab-2',
      projectItemId: 'ctx-a',
      paneRoot: { type: 'leaf', id: 'pane-2', ptyId: -1 },
      focusedPaneId: 'pane-2',
    });
    _tabs.push(tab1, tab2);

    setPtyIdInTab('tab-1', 'pane-1', 55);

    const sibling = _tabs.find((t) => t.id === 'tab-2')!;
    expect((sibling.paneRoot as { ptyId: number }).ptyId).toBe(-1);
  });
});

describe('resolveProjectItemCwd', () => {
  it('returns project path for bare project ID', () => {
    expect(resolveProjectItemCwd('ws-1')).toBe('/repos/my-project');
  });

  it('returns project path for branch context', () => {
    expect(resolveProjectItemCwd('ws-1-branch-main')).toBe('/repos/my-project');
  });

  it('returns worktree path for worktree context', () => {
    expect(resolveProjectItemCwd('ws-1-wt-feature-x')).toBe('/worktrees/feature-x');
  });

  it('returns undefined for unknown project item ID', () => {
    expect(resolveProjectItemCwd('unknown-id')).toBeUndefined();
  });

  it('returns undefined for "default"', () => {
    expect(resolveProjectItemCwd('default')).toBeUndefined();
  });

  it('falls back to project path for unknown worktree name', () => {
    expect(resolveProjectItemCwd('ws-1-wt-nonexistent')).toBe('/repos/my-project');
  });
});

describe('addTab', () => {
  beforeEach(resetState);

  it('stores cwd setting for the new pane', () => {
    _uiState.activeContextId = 'ws-1-wt-feature-x';

    addTab();

    const cwdCall = findCwdSettingCall();
    expect(cwdCall).toBeDefined();
    expect(cwdCall![1]).toBe('/worktrees/feature-x');
  });

  it('stores repo root as cwd for branch context', () => {
    _uiState.activeContextId = 'ws-1-branch-main';

    addTab();

    const cwdCall = findCwdSettingCall();
    expect(cwdCall).toBeDefined();
    expect(cwdCall![1]).toBe('/repos/my-project');
  });

  it('does not store cwd for unknown context', () => {
    _uiState.activeContextId = 'unknown-ctx';

    addTab();

    const cwdCall = findCwdSettingCall();
    expect(cwdCall).toBeUndefined();
  });

  it('navigates to the new tab URL', () => {
    _uiState.activeContextId = 'ws-1';

    addTab();

    expect(mockRouterNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/projects/$projectId/tabs/$tabId' }),
    );
  });
});

describe('splitPane', () => {
  beforeEach(resetState);

  it('stores cwd setting for the new split pane', () => {
    const tab = makeTab({ id: 'tab-1', projectItemId: 'ws-1-wt-feature-x' });
    _tabs.push(tab);
    _uiState.activeTabId = 'tab-1';

    splitPane('pane-1', 'horizontal', -1);

    const cwdCall = findCwdSettingCall();
    expect(cwdCall).toBeDefined();
    expect(cwdCall![1]).toBe('/worktrees/feature-x');
  });
});

describe('addClaudeCodeTab', () => {
  beforeEach(resetState);

  it('inserts the tab and navigates when the active context matches', () => {
    _uiState.activeContextId = 'ws-1';

    addClaudeCodeTab('ws-1');

    expect(_tabs).toHaveLength(1);
    expect(mockRouterNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/projects/$projectId/tabs/$tabId' }),
    );
  });

  it('inserts silently (no navigation) when on a different context', () => {
    _uiState.activeContextId = 'ws-1-branch-main';

    addClaudeCodeTab('ws-1-wt-feature-x');

    expect(_tabs).toHaveLength(1);
    expect(mockRouterNavigate).not.toHaveBeenCalled();
  });

  it('sets bypass-permissions command by default', () => {
    _uiState.activeContextId = 'ws-1';

    addClaudeCodeTab('ws-1');

    const initCmdCall = mockSetSetting.mock.calls.find(
      ([key]) => typeof key === 'string' && key.startsWith('init-cmd:'),
    );
    expect(initCmdCall![1]).toContain('--permission-mode bypassPermissions');
  });

  it('sets plan-mode command when mode is plan', () => {
    _uiState.activeContextId = 'ws-1';

    addClaudeCodeTab('ws-1', { mode: 'plan' });

    const initCmdCall = mockSetSetting.mock.calls.find(
      ([key]) => typeof key === 'string' && key.startsWith('init-cmd:'),
    );
    expect(initCmdCall![1]).toContain('--permission-mode plan');
  });

  it('appends prompt as single-quoted CLI arg', () => {
    _uiState.activeContextId = 'ws-1';

    addClaudeCodeTab('ws-1', { prompt: 'fix the tests' });

    const initCmdCall = mockSetSetting.mock.calls.find(
      ([key]) => typeof key === 'string' && key.startsWith('init-cmd:'),
    );
    expect(initCmdCall![1]).toMatch(/'fix the tests'$/);
  });

  it('escapes single quotes in the prompt', () => {
    _uiState.activeContextId = 'ws-1';

    addClaudeCodeTab('ws-1', { prompt: "it's broken" });

    const initCmdCall = mockSetSetting.mock.calls.find(
      ([key]) => typeof key === 'string' && key.startsWith('init-cmd:'),
    );
    expect(initCmdCall![1]).toContain("'it'\\''s broken'");
  });

  it('stores init-has-prompt flag when prompt is provided', () => {
    _uiState.activeContextId = 'ws-1';

    addClaudeCodeTab('ws-1', { prompt: 'hello' });

    const hasPromptCall = mockSetSetting.mock.calls.find(
      ([key]) => typeof key === 'string' && key.startsWith('init-has-prompt:'),
    );
    expect(hasPromptCall![1]).toBe('true');
  });

  it('does not store init-has-prompt when no prompt is given', () => {
    _uiState.activeContextId = 'ws-1';

    addClaudeCodeTab('ws-1');

    const hasPromptCall = mockSetSetting.mock.calls.find(
      ([key]) => typeof key === 'string' && key.startsWith('init-has-prompt:'),
    );
    expect(hasPromptCall).toBeUndefined();
  });

  it('is a no-op when no projectItemId and no activeContextId', () => {
    _uiState.activeContextId = '';

    addClaudeCodeTab();

    expect(_tabs).toHaveLength(0);
    expect(mockSetSetting).not.toHaveBeenCalled();
  });
});
