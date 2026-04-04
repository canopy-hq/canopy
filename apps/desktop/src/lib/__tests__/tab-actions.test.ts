import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Tab, Workspace } from '@superagent/db';
import type { UiState } from '@superagent/db';

// ── In-memory mock for @superagent/db ────────────────────────────────────────

let _tabs: Tab[] = [];
let _uiState: UiState = {
  id: 'ui',
  sidebarVisible: false,
  sidebarWidth: 400,
  selectedItemId: null,
  activeTabId: '',
  activeContextId: '',
  contextActiveTabIds: {},
};

const _workspaces: Workspace[] = [
  {
    id: 'ws-1',
    path: '/repos/my-project',
    name: 'my-project',
    branches: [{ name: 'main', is_head: true, ahead: 0, behind: 0 }],
    worktrees: [{ name: 'feature-x', path: '/worktrees/feature-x', branch: 'feature-x' }],
    expanded: true,
    position: 0,
  },
];

const mockSetSetting = vi.fn();

vi.mock('@superagent/db', () => ({
  getWorkspaceCollection: () => ({
    get toArray() {
      return [..._workspaces];
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
  uiCollection: {
    update: (_key: string, updater: (draft: UiState) => void) => {
      updater(_uiState);
    },
  },
  getUiState: () => _uiState,
  setSetting: (...args: unknown[]) => mockSetSetting(...args),
}));

// Import AFTER mock is set up
import {
  closeTab,
  setActiveContext,
  setPtyIdInTab,
  addTab,
  splitPane,
  resolveWorkspaceItemCwd,
} from '../tab-actions';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTab(overrides: Partial<Tab> & { id: string; workspaceItemId: string }): Tab {
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
    ([key]: [string]) => typeof key === 'string' && key.startsWith('cwd:'),
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
  };
  mockSetSetting.mockClear();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('setActiveContext', () => {
  beforeEach(resetState);

  it('sets activeTabId to empty string when no tabs exist for context', () => {
    _uiState.activeContextId = 'old-ctx';
    _uiState.activeTabId = 'old-tab';

    setActiveContext('new-ctx');

    expect(_uiState.activeContextId).toBe('new-ctx');
    expect(_uiState.activeTabId).toBe('');
    expect(_tabs).toHaveLength(0);
  });

  it('restores last active tab when switching back to context with tabs', () => {
    // Set up: context-a has a tab
    const tab = makeTab({ id: 'tab-a', workspaceItemId: 'ctx-a' });
    _tabs.push(tab);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-a';

    // Switch to ctx-b (no tabs)
    setActiveContext('ctx-b');
    expect(_uiState.activeContextId).toBe('ctx-b');
    expect(_uiState.activeTabId).toBe('');

    // Switch back to ctx-a
    setActiveContext('ctx-a');
    expect(_uiState.activeContextId).toBe('ctx-a');
    expect(_uiState.activeTabId).toBe('tab-a');
  });

  it('restores the saved active tab (not just the first) when switching back', () => {
    const tab1 = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a', position: 0 });
    const tab2 = makeTab({ id: 'tab-2', workspaceItemId: 'ctx-a', position: 1 });
    _tabs.push(tab1, tab2);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-2'; // tab-2 is active, not tab-1

    // Switch away
    setActiveContext('ctx-b');
    expect(_uiState.contextActiveTabIds['ctx-a']).toBe('tab-2');

    // Switch back
    setActiveContext('ctx-a');
    expect(_uiState.activeTabId).toBe('tab-2');
  });
});

describe('closeTab', () => {
  beforeEach(resetState);

  it('sets activeTabId to empty string when closing the last tab', () => {
    const tab = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a' });
    _tabs.push(tab);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-1';

    closeTab('tab-1');

    expect(_uiState.activeTabId).toBe('');
    expect(_tabs).toHaveLength(0);
  });

  it('cleans up contextActiveTabIds when closing the last tab', () => {
    const tab = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a' });
    _tabs.push(tab);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-1';
    _uiState.contextActiveTabIds = { 'ctx-a': 'tab-1', 'ctx-b': 'tab-other' };

    closeTab('tab-1');

    expect(_uiState.contextActiveTabIds).not.toHaveProperty('ctx-a');
    expect(_uiState.contextActiveTabIds).toHaveProperty('ctx-b', 'tab-other');
  });

  it('switches to another tab when closing a non-last tab', () => {
    const tab1 = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a', position: 0 });
    const tab2 = makeTab({ id: 'tab-2', workspaceItemId: 'ctx-a', position: 1 });
    _tabs.push(tab1, tab2);
    _uiState.activeContextId = 'ctx-a';
    _uiState.activeTabId = 'tab-1';

    closeTab('tab-1');

    expect(_tabs).toHaveLength(1);
    expect(_uiState.activeTabId).toBe('tab-2');
  });
});

describe('setPtyIdInTab', () => {
  beforeEach(resetState);

  it('sets ptyId on a single-leaf root tab', () => {
    const tab = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a' });
    _tabs.push(tab);

    setPtyIdInTab('tab-1', 'pane-1', 999);

    const updated = _tabs.find((t) => t.id === 'tab-1')!;
    expect(updated.paneRoot.type).toBe('leaf');
    expect((updated.paneRoot as { ptyId: number }).ptyId).toBe(999);
  });

  it('sets ptyId on the correct leaf in a split (branch) tab', () => {
    const tab = makeTab({
      id: 'tab-1',
      workspaceItemId: 'ctx-a',
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
    const tab = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a' });
    _tabs.push(tab);

    setPtyIdInTab('does-not-exist', 'pane-1', 99);

    const unchanged = _tabs.find((t) => t.id === 'tab-1')!;
    expect((unchanged.paneRoot as { ptyId: number }).ptyId).toBe(-1);
  });

  it('is a no-op for an unknown paneId within a valid tab', () => {
    const tab = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a' });
    _tabs.push(tab);

    setPtyIdInTab('tab-1', 'does-not-exist', 77);

    const unchanged = _tabs.find((t) => t.id === 'tab-1')!;
    expect((unchanged.paneRoot as { ptyId: number }).ptyId).toBe(-1);
  });

  it('does not affect sibling tabs', () => {
    const tab1 = makeTab({ id: 'tab-1', workspaceItemId: 'ctx-a' });
    const tab2 = makeTab({
      id: 'tab-2',
      workspaceItemId: 'ctx-a',
      paneRoot: { type: 'leaf', id: 'pane-2', ptyId: -1 },
      focusedPaneId: 'pane-2',
    });
    _tabs.push(tab1, tab2);

    setPtyIdInTab('tab-1', 'pane-1', 55);

    const sibling = _tabs.find((t) => t.id === 'tab-2')!;
    expect((sibling.paneRoot as { ptyId: number }).ptyId).toBe(-1);
  });
});

describe('resolveWorkspaceItemCwd', () => {
  it('returns workspace path for bare workspace ID', () => {
    expect(resolveWorkspaceItemCwd('ws-1')).toBe('/repos/my-project');
  });

  it('returns workspace path for branch context', () => {
    expect(resolveWorkspaceItemCwd('ws-1-branch-main')).toBe('/repos/my-project');
  });

  it('returns worktree path for worktree context', () => {
    expect(resolveWorkspaceItemCwd('ws-1-wt-feature-x')).toBe('/worktrees/feature-x');
  });

  it('returns undefined for unknown workspace item ID', () => {
    expect(resolveWorkspaceItemCwd('unknown-id')).toBeUndefined();
  });

  it('returns undefined for "default"', () => {
    expect(resolveWorkspaceItemCwd('default')).toBeUndefined();
  });

  it('falls back to workspace path for unknown worktree name', () => {
    expect(resolveWorkspaceItemCwd('ws-1-wt-nonexistent')).toBe('/repos/my-project');
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
});

describe('splitPane', () => {
  beforeEach(resetState);

  it('stores cwd setting for the new split pane', () => {
    const tab = makeTab({ id: 'tab-1', workspaceItemId: 'ws-1-wt-feature-x' });
    _tabs.push(tab);
    _uiState.activeTabId = 'tab-1';

    splitPane('pane-1', 'horizontal', -1);

    const cwdCall = findCwdSettingCall();
    expect(cwdCall).toBeDefined();
    expect(cwdCall![1]).toBe('/worktrees/feature-x');
  });
});
