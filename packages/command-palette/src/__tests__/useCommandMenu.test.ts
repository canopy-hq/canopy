import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { useCommandMenu } from '../useCommandMenu';

import type { CommandItem } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function item(overrides: Partial<CommandItem> & Pick<CommandItem, 'id' | 'category'>): CommandItem {
  return { label: overrides.id, action: () => {}, ...overrides };
}

const WORKSPACE_A = item({ id: 'ws:a', category: 'project' });
const WORKSPACE_B = item({ id: 'ws:b', category: 'project' });

function tabItem(id: string, contextId: string, group?: string): CommandItem {
  return item({ id, category: 'tab', contextId, group });
}

const TAB_CTX1_A = tabItem('tab:1a', 'ctx-1', 'Project Alpha');
const TAB_CTX1_B = tabItem('tab:1b', 'ctx-1', 'Project Alpha');
const TAB_CTX2_A = tabItem('tab:2a', 'ctx-2', 'Project Beta');

const NEW_TAB = item({ id: 'action:new-tab', category: 'action' });
const TOGGLE_SIDEBAR = item({ id: 'action:toggle-sidebar', category: 'action' });

const AGENT_RUNNING = item({ id: 'agent:1', category: 'agent', agentStatus: 'running' });
const AGENT_IDLE = item({ id: 'agent:2', category: 'agent', agentStatus: 'idle' });

// ── Root section — default view ───────────────────────────────────────────────

describe('root section — default view', () => {
  it('shows tabs from active context first', () => {
    const items = [TAB_CTX1_A, TAB_CTX1_B, TAB_CTX2_A, WORKSPACE_A];
    const { result } = renderHook(() => useCommandMenu(items, 'ctx-1'));

    const tabSection = result.current.sections.find((s) => s.id === 'tabs-default');
    expect(tabSection?.items).toEqual([TAB_CTX1_A, TAB_CTX1_B]);
    expect(tabSection?.items.map((i) => i.id)).not.toContain('tab:2a');
  });

  it('falls back to New Tab action when no tabs in active context', () => {
    const items = [NEW_TAB, WORKSPACE_A];
    const { result } = renderHook(() => useCommandMenu(items, 'ctx-empty'));

    const tabSection = result.current.sections.find((s) => s.id === 'tabs-new');
    expect(tabSection?.items).toEqual([NEW_TAB]);
  });

  it('shows no tab section when no context and no tabs', () => {
    const items = [WORKSPACE_A];
    const { result } = renderHook(() => useCommandMenu(items, null));

    expect(result.current.sections.find((s) => s.id.startsWith('tabs'))).toBeUndefined();
  });

  it('orders sections: tabs → projects → agents → actions', () => {
    const items = [TAB_CTX1_A, WORKSPACE_A, AGENT_RUNNING, TOGGLE_SIDEBAR, NEW_TAB];
    const { result } = renderHook(() => useCommandMenu(items, 'ctx-1'));

    const ids = result.current.sections.map((s) => s.id);
    expect(ids.indexOf('tabs-default')).toBeLessThan(ids.indexOf('recent'));
    expect(ids.indexOf('recent')).toBeLessThan(ids.indexOf('agents-default'));
    expect(ids.indexOf('agents-default')).toBeLessThan(ids.indexOf('actions'));
  });

  it('excludes action:new-tab from Quick Actions section', () => {
    const items = [TAB_CTX1_A, NEW_TAB, TOGGLE_SIDEBAR];
    const { result } = renderHook(() => useCommandMenu(items, 'ctx-1'));

    const actions = result.current.sections.find((s) => s.id === 'actions');
    expect(actions?.items.map((i) => i.id)).not.toContain('action:new-tab');
    expect(actions?.items.map((i) => i.id)).toContain('action:toggle-sidebar');
  });

  it('excludes idle agents from default view', () => {
    const items = [AGENT_IDLE, AGENT_RUNNING];
    const { result } = renderHook(() => useCommandMenu(items, null));

    const agents = result.current.sections.find((s) => s.id === 'agents-default');
    expect(agents?.items.map((i) => i.id)).toEqual(['agent:1']);
  });
});

// ── Section switching ─────────────────────────────────────────────────────────

describe('section switching', () => {
  it('filters to project category in projects section', () => {
    const items = [WORKSPACE_A, WORKSPACE_B, TAB_CTX1_A];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_SECTION', section: 'projects' }));

    const flat = result.current.flatItems;
    expect(flat.map((i) => i.id)).toEqual(['ws:a', 'ws:b']);
  });

  it('filters to tab category in tabs section', () => {
    const items = [TAB_CTX1_A, TAB_CTX2_A, WORKSPACE_A];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_SECTION', section: 'tabs' }));

    expect(result.current.flatItems.every((i) => i.category === 'tab')).toBe(true);
  });

  it('filters to pty category in pty section', () => {
    const pty = item({ id: 'pty:1', category: 'pty' });
    const items = [pty, TAB_CTX1_A];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_SECTION', section: 'pty' }));

    expect(result.current.flatItems.map((i) => i.id)).toEqual(['pty:1']);
  });

  it('resets query when switching sections', () => {
    const items = [WORKSPACE_A];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_QUERY', query: 'hello' }));
    act(() => result.current.dispatch({ type: 'SET_SECTION', section: 'projects' }));

    expect(result.current.query).toBe('');
  });
});

// ── Grouping (tabs / pty sections) ────────────────────────────────────────────

describe('groupByField — tabs section', () => {
  it('groups items by their group field, sorted alphabetically', () => {
    const items = [
      tabItem('tab:z1', 'ctx-z', 'Zebra'),
      tabItem('tab:a1', 'ctx-a', 'Apple'),
      tabItem('tab:a2', 'ctx-a', 'Apple'),
    ];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_SECTION', section: 'tabs' }));

    const sectionLabels = result.current.sections.map((s) => s.label);
    expect(sectionLabels).toEqual(['Apple', 'Zebra']);
  });

  it('puts ungrouped items under "Other"', () => {
    const noGroup = item({ id: 'tab:ng', category: 'tab' }); // no group field
    const { result } = renderHook(() => useCommandMenu([noGroup]));

    act(() => result.current.dispatch({ type: 'SET_SECTION', section: 'tabs' }));

    expect(result.current.sections[0]?.label).toBe('Other');
  });
});

// ── Fuzzy search ──────────────────────────────────────────────────────────────

describe('fuzzy search', () => {
  it('filters items by query in root section', () => {
    const items = [
      item({ id: 'ws:alpha', category: 'project', label: 'Alpha' }),
      item({ id: 'ws:beta', category: 'project', label: 'Beta' }),
    ];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_QUERY', query: 'alp' }));

    expect(result.current.flatItems.map((i) => i.id)).toEqual(['ws:alpha']);
  });

  it('searches within section', () => {
    const items = [
      item({ id: 'ws:alpha', category: 'project', label: 'Alpha' }),
      item({ id: 'ws:beta', category: 'project', label: 'Beta' }),
    ];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_SECTION', section: 'projects' }));
    act(() => result.current.dispatch({ type: 'SET_QUERY', query: 'bet' }));

    expect(result.current.flatItems.map((i) => i.id)).toEqual(['ws:beta']);
  });
});

// ── Drill-down ────────────────────────────────────────────────────────────────

describe('drill-down', () => {
  const child1 = item({ id: 'child:1', category: 'project', label: 'Child 1' });
  const parent = item({
    id: 'ws:parent',
    category: 'project',
    label: 'Parent',
    children: () => [child1],
  });

  it('shows children when drilled into', () => {
    const { result } = renderHook(() => useCommandMenu([parent]));

    act(() => result.current.dispatch({ type: 'DRILL_INTO', item: parent }));

    expect(result.current.flatItems.map((i) => i.id)).toEqual(['child:1']);
  });

  it('returns to root on DRILL_BACK', () => {
    const { result } = renderHook(() => useCommandMenu([parent]));

    act(() => result.current.dispatch({ type: 'DRILL_INTO', item: parent }));
    act(() => result.current.dispatch({ type: 'DRILL_BACK' }));

    expect(result.current.flatItems.map((i) => i.id)).toContain('ws:parent');
  });
});

// ── Auto-selection ────────────────────────────────────────────────────────────

describe('selectedId', () => {
  it('auto-selects first item', () => {
    const items = [WORKSPACE_A, WORKSPACE_B];
    const { result } = renderHook(() => useCommandMenu(items));

    expect(result.current.selectedId).toBe('ws:a');
  });

  it('resets to first item when query changes', () => {
    const items = [
      item({ id: 'ws:alpha', category: 'project', label: 'Alpha' }),
      item({ id: 'ws:beta', category: 'project', label: 'Beta' }),
    ];
    const { result } = renderHook(() => useCommandMenu(items));

    act(() => result.current.dispatch({ type: 'SET_SELECTED', id: 'ws:beta' }));
    act(() => result.current.dispatch({ type: 'SET_QUERY', query: 'x' })); // no results

    expect(result.current.selectedId).toBeNull();
  });
});
