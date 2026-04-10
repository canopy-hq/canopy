import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { Group, Project } from '@superagent/db';

// ── In-memory mock for @superagent/db ────────────────────────────────────────

let _groups: Group[] = [];
let _projects: Project[] = [];

vi.mock('@superagent/db', () => ({
  getGroupCollection: () => ({
    get toArray() {
      return [..._groups];
    },
    insert: (group: Group) => {
      _groups.push(group);
    },
    delete: (id: string) => {
      _groups = _groups.filter((g) => g.id !== id);
    },
    update: (id: string, updater: (draft: Group) => void) => {
      const group = _groups.find((g) => g.id === id);
      if (group) updater(group);
    },
  }),
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
}));

// Import AFTER mocks are set up
import {
  createGroup,
  deleteGroup,
  renameGroup,
  reorderGroups,
  toggleGroupCollapsed,
  assignProjectToGroup,
} from '../group-actions';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeGroup(overrides: Partial<Group> & { id: string }): Group {
  return { name: 'My group', position: 0, collapsed: false, ...overrides };
}

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

// ── createGroup ───────────────────────────────────────────────────────────────

describe('createGroup', () => {
  beforeEach(() => {
    _groups = [];
    _projects = [];
  });

  it('inserts a group with the given name and returns its id', () => {
    const id = createGroup('Backend');
    expect(_groups).toHaveLength(1);
    expect(_groups[0]!.name).toBe('Backend');
    expect(_groups[0]!.id).toBe(id);
  });

  it('trims whitespace from the name', () => {
    createGroup('  Frontend  ');
    expect(_groups[0]!.name).toBe('Frontend');
  });

  it('falls back to "New group" when name is blank', () => {
    createGroup('   ');
    expect(_groups[0]!.name).toBe('New group');
  });

  it('sets position to the current group count', () => {
    _groups = [makeGroup({ id: 'g1', position: 0 }), makeGroup({ id: 'g2', position: 1 })];
    createGroup('Third');
    const inserted = _groups.find((g) => g.name === 'Third')!;
    expect(inserted.position).toBe(2);
  });

  it('sets collapsed to false', () => {
    createGroup('New');
    expect(_groups[0]!.collapsed).toBe(false);
  });
});

// ── deleteGroup ───────────────────────────────────────────────────────────────

describe('deleteGroup', () => {
  beforeEach(() => {
    _groups = [];
    _projects = [];
  });

  it('removes the group', () => {
    _groups = [makeGroup({ id: 'g1' })];
    deleteGroup('g1');
    expect(_groups).toHaveLength(0);
  });

  it('orphans projects belonging to the deleted group', () => {
    _groups = [makeGroup({ id: 'g1' })];
    _projects = [
      makeProject({ id: 'p1', path: '/p1', groupId: 'g1' }),
      makeProject({ id: 'p2', path: '/p2', groupId: 'g1' }),
    ];
    deleteGroup('g1');
    expect(_projects[0]!.groupId).toBeNull();
    expect(_projects[1]!.groupId).toBeNull();
  });

  it('does not touch projects belonging to other groups', () => {
    _groups = [makeGroup({ id: 'g1' }), makeGroup({ id: 'g2', position: 1 })];
    _projects = [makeProject({ id: 'p1', path: '/p1', groupId: 'g2' })];
    deleteGroup('g1');
    expect(_projects[0]!.groupId).toBe('g2');
  });

  it('does not touch ungrouped projects', () => {
    _groups = [makeGroup({ id: 'g1' })];
    _projects = [makeProject({ id: 'p1', path: '/p1', groupId: null })];
    deleteGroup('g1');
    expect(_projects[0]!.groupId).toBeNull();
  });
});

// ── renameGroup ───────────────────────────────────────────────────────────────

describe('renameGroup', () => {
  beforeEach(() => {
    _groups = [makeGroup({ id: 'g1', name: 'Old name' })];
    _projects = [];
  });

  it('updates the group name', () => {
    renameGroup('g1', 'New name');
    expect(_groups[0]!.name).toBe('New name');
  });

  it('trims whitespace from the new name', () => {
    renameGroup('g1', '  Trimmed  ');
    expect(_groups[0]!.name).toBe('Trimmed');
  });

  it('is a no-op when the trimmed name is empty', () => {
    renameGroup('g1', '   ');
    expect(_groups[0]!.name).toBe('Old name');
  });
});

// ── toggleGroupCollapsed ──────────────────────────────────────────────────────

describe('toggleGroupCollapsed', () => {
  beforeEach(() => {
    _groups = [makeGroup({ id: 'g1', collapsed: false })];
    _projects = [];
  });

  it('collapses an expanded group', () => {
    toggleGroupCollapsed('g1');
    expect(_groups[0]!.collapsed).toBe(true);
  });

  it('expands a collapsed group', () => {
    _groups[0]!.collapsed = true;
    toggleGroupCollapsed('g1');
    expect(_groups[0]!.collapsed).toBe(false);
  });
});

// ── reorderGroups ─────────────────────────────────────────────────────────────

describe('reorderGroups', () => {
  beforeEach(() => {
    _groups = [
      makeGroup({ id: 'g1', position: 0 }),
      makeGroup({ id: 'g2', position: 1 }),
      makeGroup({ id: 'g3', position: 2 }),
    ];
    _projects = [];
  });

  it('assigns position = index for each id in the given order', () => {
    reorderGroups(['g3', 'g1', 'g2']);
    expect(_groups.find((g) => g.id === 'g3')!.position).toBe(0);
    expect(_groups.find((g) => g.id === 'g1')!.position).toBe(1);
    expect(_groups.find((g) => g.id === 'g2')!.position).toBe(2);
  });

  it('handles a single-element array', () => {
    reorderGroups(['g2']);
    expect(_groups.find((g) => g.id === 'g2')!.position).toBe(0);
  });
});

// ── assignProjectToGroup ──────────────────────────────────────────────────────

describe('assignProjectToGroup', () => {
  beforeEach(() => {
    _groups = [makeGroup({ id: 'g1' }), makeGroup({ id: 'g2', position: 1 })];
    _projects = [makeProject({ id: 'p1', path: '/p1', groupId: 'g1' })];
  });

  it('moves a project to a different group', () => {
    assignProjectToGroup('p1', 'g2');
    expect(_projects[0]!.groupId).toBe('g2');
  });

  it('ungrouped a project when groupId is null', () => {
    assignProjectToGroup('p1', null);
    expect(_projects[0]!.groupId).toBeNull();
  });

  it('assigns an ungrouped project to a group', () => {
    _projects = [makeProject({ id: 'p2', path: '/p2', groupId: null })];
    assignProjectToGroup('p2', 'g1');
    expect(_projects[0]!.groupId).toBe('g1');
  });
});
