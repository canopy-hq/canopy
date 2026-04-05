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
  panelItem: CommandItem | null;
}

type MenuAction =
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_SECTION'; section: MenuSection }
  | { type: 'DRILL_INTO'; item: CommandItem }
  | { type: 'DRILL_BACK' }
  | { type: 'SET_SELECTED'; id: string | null }
  | { type: 'OPEN_PANEL'; item: CommandItem }
  | { type: 'CLOSE_PANEL' }
  | { type: 'RESET' };

const INITIAL_STATE: MenuState = {
  query: '',
  section: 'root',
  drillStack: [],
  selectedId: null,
  panelItem: null,
};

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
    case 'OPEN_PANEL':
      return { ...state, panelItem: action.item, query: '', selectedId: null };
    case 'CLOSE_PANEL':
      return { ...state, panelItem: null };
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

  // Active workspace section — shown first so the most relevant actions are immediately visible
  const actionItems = items.filter(
    (i) =>
      i.category === 'action' &&
      (!i.contextId || (activeContextId != null && activeContextId.startsWith(i.contextId))),
  );
  if (actionItems.length > 0) {
    const activeWsItem = activeContextId
      ? items.find(
          (i) =>
            i.category === 'workspace' &&
            activeContextId.startsWith(i.id.replace(/^workspace:/, '')),
        )
      : null;
    sections.push({
      id: 'actions',
      label: activeWsItem ? activeWsItem.label : 'Quick Actions',
      items: actionItems,
    });
  }

  const allTabs = items.filter((i) => i.category === 'tab');
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

  const globalItems = items.filter((i) => i.category === 'global');
  if (globalItems.length > 0) sections.push({ id: 'global', label: 'Global', items: globalItems });

  return sections;
}

function filterByCategorySection(items: CommandItem[], section: MenuSection): CommandItem[] {
  switch (section) {
    case 'projects':
      return items.filter((i) => i.category === 'workspace');
    case 'tabs':
      return items.filter((i) => i.category === 'tab');
    case 'pty':
      return items.filter((i) => i.category === 'pty');
    case 'agents':
      return items.filter((i) => i.category === 'agent');
    default:
      return items;
  }
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
  const { query, section, drillStack, selectedId: rawSelectedId, panelItem } = state;

  const sections = useMemo((): SectionData[] => {
    if (panelItem) return [];

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
    // rawSelectedId excluded — section content is independent of which item is highlighted
  }, [query, section, drillStack, panelItem, items, activeContextId]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  const selectedId = useMemo(() => {
    if (rawSelectedId !== null && flatItems.some((i) => i.id === rawSelectedId)) {
      return rawSelectedId;
    }
    return flatItems[0]?.id ?? null;
  }, [rawSelectedId, flatItems]);

  return {
    query: state.query,
    section: state.section,
    drillStack: state.drillStack,
    panelItem: state.panelItem,
    selectedId,
    dispatch,
    sections,
    flatItems,
  };
}
