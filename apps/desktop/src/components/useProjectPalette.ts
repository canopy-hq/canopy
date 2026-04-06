import { useState, useEffect, useMemo, useCallback } from 'react';

import { fuzzyScore } from '@superagent/command-palette';
import { useNavigate } from '@tanstack/react-router';

import {
  listAllBranches,
  listWorktrees,
  fetchRemote,
  sanitizeWorktreeName,
  buildWorktreePath,
  type BranchDetail,
  type WorktreeInfo,
} from '../lib/git';
import { startWorktreeCreation, openWorktree } from '../lib/project-actions';

import type { PanelContext } from '@superagent/command-palette';
import type { Project } from '@superagent/db';

// ── Types ──────────────────────────────────────────────────────────────────────

export type PaletteItemKind = 'create' | 'branch' | 'worktree' | 'quick-base';

export interface PaletteItem {
  id: string;
  kind: PaletteItemKind;
  /** Display name — set for 'create' items (the sanitized branch/worktree name). */
  label?: string;
  /** Present for 'branch' items (main list and base picker). */
  branch?: BranchDetail;
  /** Present for 'worktree' items. */
  worktree?: WorktreeInfo & { isInSidebar: boolean };
  /** Present for 'quick-base' items. */
  quickBaseAction?: 'from-default' | 'from-other';
}

export interface PaletteSection {
  id: string;
  label: string;
  items: PaletteItem[];
}

export interface UseProjectPaletteReturn {
  // Search
  query: string;
  setQuery: (q: string) => void;
  // Tab filter
  tab: 'all' | 'worktrees';
  setTab: (t: 'all' | 'worktrees') => void;
  // Create flow
  isCreateMode: boolean;
  sanitizedName: string;
  baseBranch: string;
  quickBase: boolean;
  setQuickBase: (v: boolean) => void;
  pickingBase: boolean;
  setPickingBase: (v: boolean) => void;
  // Navigation (same contract as useCommandMenu)
  sections: PaletteSection[];
  flatItems: PaletteItem[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  // Raw data (for counts, etc.)
  branches: BranchDetail[];
  diskWorktrees: (WorktreeInfo & { isInSidebar: boolean })[];
  // Actions
  handleCreateWorktree: (opts?: { existingBranch?: string; base?: string }) => void;
  handleOpenWorktree: (name: string, path: string, branch: string) => void;
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useProjectPalette(project: Project, ctx: PanelContext): UseProjectPaletteReturn {
  const navigate = useNavigate();
  const [query, setQueryRaw] = useState('');
  const [tab, setTab] = useState<'all' | 'worktrees'>('all');
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [allWorktrees, setAllWorktrees] = useState<WorktreeInfo[]>([]);
  const [baseBranch, setBaseBranch] = useState('');
  const [quickBase, setQuickBase] = useState(false);
  const [pickingBase, setPickingBase] = useState(false);
  const [_selectedId, _setSelectedId] = useState<string | null>(null);

  // Load data when workspace changes
  useEffect(() => {
    let stale = false;
    setBranches([]);
    setAllWorktrees([]);
    setQueryRaw('');
    setTab('all');
    setQuickBase(false);
    setPickingBase(false);
    _setSelectedId(null);

    listAllBranches(project.path)
      .then((b) => {
        if (!stale) setBranches(b);
      })
      .catch(() => {});
    listWorktrees(project.path)
      .then((wts) => {
        if (!stale) setAllWorktrees(wts);
      })
      .catch(() => {});
    fetchRemote(project.path)
      .then(() => {
        if (stale) return;
        return listAllBranches(project.path);
      })
      .then((b) => {
        if (b && !stale) setBranches(b);
      })
      .catch((e) => console.warn('[useProjectPalette] fetch remote failed:', e));

    const head = project.branches.find((b) => b.is_head);
    setBaseBranch(head?.name ?? 'main');

    return () => {
      stale = true;
    };
  }, [project]);

  // Fuzzy filtering
  const lowerQuery = useMemo(() => query.toLowerCase(), [query]);

  const filteredBranches = useMemo(() => {
    if (!query) return branches;
    return branches
      .map((b) => ({ b, score: fuzzyScore(lowerQuery, b.name.toLowerCase()) }))
      .filter(({ score }) => score > 0)
      .sort((a, z) => z.score - a.score)
      .map(({ b }) => b);
  }, [branches, query, lowerQuery]);

  const exactMatch = useMemo(
    () => branches.find((b) => b.name.toLowerCase() === lowerQuery.trim()),
    [branches, lowerQuery],
  );

  const isCreateMode = query.trim().length > 0 && !exactMatch;
  const sanitizedName = useMemo(() => sanitizeWorktreeName(query), [query]);

  const sidebarNames = useMemo(
    () => new Set(project.worktrees.map((wt) => wt.name)),
    [project.worktrees],
  );
  const diskWorktrees = useMemo(
    () => allWorktrees.map((wt) => ({ ...wt, isInSidebar: sidebarNames.has(wt.name) })),
    [allWorktrees, sidebarNames],
  );
  const filteredWorktrees = useMemo(() => {
    if (!query) return diskWorktrees;
    return diskWorktrees
      .map((wt) => ({ wt, score: fuzzyScore(lowerQuery, wt.name.toLowerCase()) }))
      .filter(({ score }) => score > 0)
      .sort((a, z) => z.score - a.score)
      .map(({ wt }) => wt);
  }, [diskWorktrees, query, lowerQuery]);

  // Sections
  const sections = useMemo((): PaletteSection[] => {
    // Quick base picker: two options before the full branch list
    if (quickBase) {
      return [
        {
          id: 'quick-base',
          label: '',
          items: [
            {
              id: 'quick-base:default',
              kind: 'quick-base',
              label: baseBranch,
              quickBaseAction: 'from-default',
            },
            {
              id: 'quick-base:other',
              kind: 'quick-base',
              label: 'from another branch…',
              quickBaseAction: 'from-other',
            },
          ],
        },
      ];
    }

    // Full base picker replaces the main list
    if (pickingBase) {
      return [
        {
          id: 'base',
          label: 'Select base branch',
          items: branches
            .filter((b) => !b.is_in_worktree)
            .sort((a, b) => (a.name === baseBranch ? -1 : b.name === baseBranch ? 1 : 0))
            .map((b) => ({ id: `base:${b.name}`, kind: 'branch' as const, branch: b })),
        },
      ];
    }

    const branchItems: PaletteItem[] = filteredBranches.map((b) => ({
      id: `branch:${b.name}`,
      kind: 'branch',
      branch: b,
    }));
    const worktreeItems: PaletteItem[] = filteredWorktrees.map((wt) => ({
      id: `worktree:${wt.name}`,
      kind: 'worktree',
      worktree: wt,
    }));
    const createItem: PaletteItem = {
      id: `create:${sanitizedName}`,
      kind: 'create',
      label: sanitizedName,
    };

    if (tab === 'worktrees') {
      return worktreeItems.length > 0
        ? [{ id: 'worktrees', label: 'Worktrees', items: worktreeItems }]
        : [];
    }

    // All tab — merge when searching, separate sections when not
    if (query) {
      const merged = [...branchItems, ...worktreeItems];
      if (isCreateMode) {
        return [
          { id: 'create', label: '', items: [createItem] },
          ...(merged.length > 0 ? [{ id: 'results', label: 'Results', items: merged }] : []),
        ];
      }
      return merged.length > 0 ? [{ id: 'results', label: '', items: merged }] : [];
    }

    const result: PaletteSection[] = [];
    if (branchItems.length) result.push({ id: 'branches', label: 'Branches', items: branchItems });
    if (worktreeItems.length)
      result.push({ id: 'worktrees', label: 'Worktrees', items: worktreeItems });
    return result;
  }, [
    quickBase,
    pickingBase,
    tab,
    filteredBranches,
    filteredWorktrees,
    branches,
    baseBranch,
    query,
    isCreateMode,
    sanitizedName,
  ]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // selectedId falls back to first item (same as useCommandMenu)
  const selectedId = useMemo(() => {
    if (_selectedId !== null && flatItems.some((i) => i.id === _selectedId)) return _selectedId;
    return flatItems[0]?.id ?? null;
  }, [_selectedId, flatItems]);

  // Reset selection when items change (same as SET_QUERY clearing selectedId in useCommandMenu)
  const setQuery = useCallback((q: string) => {
    setQueryRaw(q);
    setQuickBase(false);
    _setSelectedId(null);
  }, []);

  // Actions
  const handleCreateWorktree = useCallback(
    (opts?: { existingBranch?: string; base?: string }) => {
      const { existingBranch, base = baseBranch } = opts ?? {};
      const wtName = existingBranch ? sanitizeWorktreeName(existingBranch) : sanitizedName;
      if (!wtName) return;
      const wtPath = buildWorktreePath(project.path, wtName);
      const newBranch = existingBranch ? undefined : wtName;
      ctx.close();
      startWorktreeCreation(
        project.id,
        wtName,
        wtPath,
        existingBranch ?? base,
        newBranch,
        navigate,
      );
    },
    [sanitizedName, project, baseBranch, ctx, navigate],
  );

  const handleOpenWorktree = useCallback(
    (name: string, path: string, branch: string) => {
      openWorktree(project.id, name, path, branch);
      ctx.close();
    },
    [project.id, ctx],
  );

  return {
    query,
    setQuery,
    tab,
    setTab,
    isCreateMode,
    sanitizedName,
    baseBranch,
    quickBase,
    setQuickBase,
    pickingBase,
    setPickingBase,
    sections,
    flatItems,
    selectedId,
    setSelectedId: _setSelectedId,
    branches,
    diskWorktrees,
    handleCreateWorktree,
    handleOpenWorktree,
  };
}
