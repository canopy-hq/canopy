import { useReducer, useMemo } from 'react';

import { fuzzyFilter } from './fuzzy';

import type { CommandItem } from './types';

export type MenuSection = 'root' | 'projects' | 'tabs' | 'pty' | 'agents';

export interface SectionData {
  id: string;
  label: string;
  items: CommandItem[];
}

interface MenuState {
  query: string;
  section: MenuSection;
  drillStack: CommandItem[];
  selectedId: string | null;
}

type MenuAction =
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_SECTION'; section: MenuSection }
  | { type: 'DRILL_INTO'; item: CommandItem }
  | { type: 'DRILL_BACK' }
  | { type: 'SET_SELECTED'; id: string | null }
  | { type: 'RESET' };

const INITIAL_STATE: MenuState = { query: '', section: 'root', drillStack: [], selectedId: null };

function reducer(state: MenuState, action: MenuAction): MenuState {
  switch (action.type) {
    case 'SET_QUERY':
      return { ...state, query: action.query, selectedId: null };
    case 'SET_SECTION':
      return { ...state, section: action.section, query: '', selectedId: null, drillStack: [] };
    case 'DRILL_INTO':
      return {
        ...state,
        drillStack: [...state.drillStack, action.item],
        query: '',
        selectedId: null,
      };
    case 'DRILL_BACK':
      return { ...state, drillStack: state.drillStack.slice(0, -1), selectedId: null };
    case 'SET_SELECTED':
      return { ...state, selectedId: action.id };
    case 'RESET':
      return INITIAL_STATE;
  }
}

const MAX_DEFAULT_PER_SECTION = 5;
const MAX_SEARCH_RESULTS = 50;

function buildDefaultSections(
  items: CommandItem[],
  activeContextId?: string | null,
): SectionData[] {
  const sections: SectionData[] = [];

  const allTabs = items.filter((i) => i.category === 'tab');
  // Filter to tabs belonging to the active project via their stable contextId.
  // Falls back to all tabs (capped) when no context is active.
  const currentTabs = activeContextId
    ? allTabs.filter((i) => i.contextId === activeContextId)
    : allTabs.slice(0, MAX_DEFAULT_PER_SECTION);

  const newTabAction = items.find((i) => i.id === 'action:new-tab');

  if (currentTabs.length > 0) {
    sections.push({ id: 'tabs-default', label: 'Open Tabs', items: currentTabs });
  } else if (newTabAction) {
    sections.push({ id: 'tabs-new', label: 'Terminal', items: [newTabAction] });
  }

  const workspaceItems = items
    .filter((i) => i.category === 'workspace')
    .slice(0, MAX_DEFAULT_PER_SECTION);
  if (workspaceItems.length > 0)
    sections.push({ id: 'recent', label: 'Recent Workspaces', items: workspaceItems });

  const agentItems = items.filter((i) => i.category === 'agent' && i.agentStatus !== 'idle');
  if (agentItems.length > 0)
    sections.push({ id: 'agents-default', label: 'Running Agents', items: agentItems });

  const actionItems = items.filter((i) => i.category === 'action' && i.id !== 'action:new-tab');
  if (actionItems.length > 0)
    sections.push({ id: 'actions', label: 'Quick Actions', items: actionItems });

  return sections;
}

function filterByCategorySection(items: CommandItem[], section: MenuSection): CommandItem[] {
  if (section === 'projects') return items.filter((i) => i.category === 'workspace');
  if (section === 'tabs') return items.filter((i) => i.category === 'tab');
  if (section === 'pty') return items.filter((i) => i.category === 'pty');
  if (section === 'agents') return items.filter((i) => i.category === 'agent');
  return items;
}

function groupByField(items: CommandItem[]): SectionData[] {
  const ungrouped: CommandItem[] = [];
  const groups = new Map<string, CommandItem[]>();

  for (const item of items) {
    if (item.group) {
      const existing = groups.get(item.group);
      if (existing) {
        existing.push(item);
      } else {
        groups.set(item.group, [item]);
      }
    } else {
      ungrouped.push(item);
    }
  }

  const sections: SectionData[] = [];
  for (const [group, groupItems] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    sections.push({ id: `group:${group}`, label: group, items: groupItems });
  }
  if (ungrouped.length > 0) {
    sections.push({ id: 'ungrouped', label: 'Other', items: ungrouped });
  }
  return sections;
}

export function useCommandMenu(items: CommandItem[], activeContextId?: string | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const { query, section, drillStack, selectedId: selectedIdState } = state;

  const sections = useMemo((): SectionData[] => {
    if (drillStack.length > 0) {
      const parent = drillStack[drillStack.length - 1]!;
      const children = parent.children?.() ?? [];
      const filtered = query ? fuzzyFilter(query, children).slice(0, MAX_SEARCH_RESULTS) : children;
      return filtered.length > 0 ? [{ id: 'drill', label: parent.label, items: filtered }] : [];
    }

    if (section !== 'root') {
      const sectionItems = filterByCategorySection(items, section);
      if (!query && (section === 'tabs' || section === 'pty')) {
        return groupByField(sectionItems);
      }
      const filtered = query
        ? fuzzyFilter(query, sectionItems).slice(0, MAX_SEARCH_RESULTS)
        : sectionItems;
      const label = section.charAt(0).toUpperCase() + section.slice(1);
      return filtered.length > 0 ? [{ id: section, label, items: filtered }] : [];
    }

    if (query) {
      const filtered = fuzzyFilter(query, items).slice(0, MAX_SEARCH_RESULTS);
      return filtered.length > 0 ? [{ id: 'results', label: 'Results', items: filtered }] : [];
    }

    return buildDefaultSections(items, activeContextId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // selectedIdState excluded — section content is independent of which item is highlighted
  }, [query, section, drillStack, items, activeContextId]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const selectedId = useMemo(() => {
    if (selectedIdState !== null && flatItems.some((i) => i.id === selectedIdState)) {
      return selectedIdState;
    }
    return flatItems[0]?.id ?? null;
  }, [selectedIdState, flatItems]);

  return {
    query: state.query,
    section: state.section,
    drillStack: state.drillStack,
    selectedId,
    dispatch,
    sections,
    flatItems,
  };
}
