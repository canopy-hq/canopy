import { useCallback, useEffect, useRef } from 'react';

import { Kbd } from '@superagent/command-palette';
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  Command,
  CornerDownLeft,
  Delete,
  GitBranch,
  GitFork,
  Plus,
  X,
} from 'lucide-react';

import { Badge } from './ui';
import { useWorkspacePalette, type PaletteItem } from './useWorkspacePalette';

import type { PanelContext } from '@superagent/command-palette';
import type { Workspace } from '@superagent/db';

export interface WorkspacePalettePanelProps {
  workspace: Workspace;
  ctx: PanelContext;
}

// ── Icon ───────────────────────────────────────────────────────────────────────

function PaletteIcon({ kind }: { kind: PaletteItem['kind'] }) {
  const props = { size: 12, strokeWidth: 1.5, className: 'shrink-0 text-text-muted' } as const;
  if (kind === 'create') return <Plus {...props} className="shrink-0 text-accent" />;
  if (kind === 'branch') return <GitBranch {...props} />;
  return <GitFork {...props} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkspacePalettePanel({ workspace, ctx }: WorkspacePalettePanelProps) {
  const {
    query,
    setQuery,
    tab,
    setTab,
    isCreateMode,
    sanitizedName,
    baseBranch,
    pickingBase,
    setPickingBase,
    sections,
    flatItems,
    selectedId,
    setSelectedId,
    branches,
    diskWorktrees,
    handleCreateWorktree,
    handleOpenWorktree,
  } = useWorkspacePalette(workspace, ctx);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Scroll selected item into view — same as CommandMenu
  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  // Activate an item — dispatched by keyboard Enter and mouse click
  const handleActivate = useCallback(
    (item: PaletteItem) => {
      if (item.kind === 'create') {
        // Enter on "Create X" opens the base picker;
        // ⌘↩ (handled in handleKeyDown) bypasses it and creates immediately.
        setPickingBase(true);
        return;
      }
      if (item.kind === 'branch') {
        if (!item.branch) return;
        if (pickingBase) {
          // Selecting a base branch → create worktree from the typed name
          void handleCreateWorktree({ base: item.branch.name });
          return;
        }
        if (item.branch.is_head || item.branch.is_in_worktree) return;
        void handleCreateWorktree({ existingBranch: item.branch.name });
        return;
      }
      if (item.kind === 'worktree' && item.worktree && !item.worktree.isInSidebar) {
        handleOpenWorktree(item.worktree.name, item.worktree.path, item.worktree.branch);
      }
    },
    [pickingBase, handleCreateWorktree, handleOpenWorktree, setPickingBase],
  );

  // Keyboard — same pattern as CommandMenu, wired to the input
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const idx = flatItems.findIndex((i) => i.id === selectedId);
          const next = flatItems.length > 0 ? flatItems[(idx + 1) % flatItems.length] : null;
          if (next) setSelectedId(next.id);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const idx = flatItems.findIndex((i) => i.id === selectedId);
          const prev =
            flatItems.length > 0
              ? flatItems[(idx - 1 + flatItems.length) % flatItems.length]
              : null;
          if (prev) setSelectedId(prev.id);
          break;
        }
        case 'Enter': {
          e.preventDefault();
          // ⌘↩ bypasses the base picker and creates immediately with current base
          if (e.metaKey && isCreateMode && !pickingBase) {
            void handleCreateWorktree();
            break;
          }
          const item = flatItems.find((i) => i.id === selectedId);
          if (item) handleActivate(item);
          break;
        }
        case 'Escape': {
          e.preventDefault();
          e.stopPropagation(); // prevent outer CommandMenu from also handling it
          ctx.close();
          break;
        }
        case 'Tab': {
          e.preventDefault();
          if (!pickingBase) {
            setTab(tab === 'all' ? 'worktrees' : 'all');
          }
          break;
        }
        case 'Backspace': {
          if (query === '') {
            e.preventDefault();
            if (pickingBase) {
              setPickingBase(false);
            } else {
              ctx.back();
            }
          }
          break;
        }
      }
    },
    [
      flatItems,
      selectedId,
      query,
      tab,
      isCreateMode,
      pickingBase,
      setSelectedId,
      setTab,
      setPickingBase,
      handleActivate,
      handleCreateWorktree,
      ctx,
    ],
  );

  // ── Selected item context for footer hints ────────────────────────────────

  const selectedItem = flatItems.find((i) => i.id === selectedId) ?? null;

  function getFooterHint() {
    const nav = (
      <span className="flex items-center gap-1">
        <Kbd>
          <ArrowUp size={9} />
        </Kbd>
        <Kbd>
          <ArrowDown size={9} />
        </Kbd>
        navigate
      </span>
    );
    const sep = <span>·</span>;
    const back = (
      <span className="flex items-center gap-1">
        <Kbd>
          <Delete size={9} />
        </Kbd>{' '}
        back
      </span>
    );
    const close = (
      <span className="flex items-center gap-1">
        <Kbd>Esc</Kbd> close
      </span>
    );

    if (isCreateMode && !pickingBase) {
      return (
        <>
          {nav}
          {sep}
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft size={9} />
            </Kbd>{' '}
            pick base
          </span>
          {sep}
          <span className="flex items-center gap-1">
            <Kbd>
              <Command size={9} />
            </Kbd>
            <Kbd>
              <CornerDownLeft size={9} />
            </Kbd>{' '}
            create
          </span>
          {sep}
          <span className="flex items-center gap-1">
            <Kbd>Tab</Kbd> filter
          </span>
          {sep}
          {back}
          {sep}
          {close}
          <span className="ml-auto font-mono opacity-80">
            git worktree add -b <span className="text-accent">{sanitizedName}</span>
            {' … '}
            <span>{baseBranch}</span>
          </span>
        </>
      );
    }
    if (pickingBase) {
      return (
        <>
          {nav}
          {sep}
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft size={9} />
            </Kbd>{' '}
            create
          </span>
          {sep}
          {back}
          {sep}
          {close}
        </>
      );
    }
    if (selectedItem?.kind === 'branch') {
      const b = selectedItem.branch!;
      if (b.is_head || b.is_in_worktree) {
        return (
          <>
            {nav}
            {sep}
            <span>{b.is_head ? 'checked out' : 'already in worktree'}</span>
            {sep}
            {back}
            {sep}
            {close}
          </>
        );
      }
      return (
        <>
          {nav}
          {sep}
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft size={9} />
            </Kbd>{' '}
            create worktree
          </span>
          {sep}
          {back}
          {sep}
          {close}
        </>
      );
    }
    if (selectedItem?.kind === 'worktree') {
      return (
        <>
          {nav}
          {sep}
          <span className="flex items-center gap-1">
            <Kbd>
              <CornerDownLeft size={9} />
            </Kbd>{' '}
            {selectedItem.worktree?.isInSidebar ? 'already open' : 'open'}
          </span>
          {sep}
          {back}
          {sep}
          {close}
        </>
      );
    }
    return (
      <>
        {nav}
        {sep}
        <span className="flex items-center gap-1">
          <Kbd>
            <CornerDownLeft size={9} />
          </Kbd>{' '}
          open
        </span>
        {sep}
        <span className="flex items-center gap-1">
          <Kbd>Tab</Kbd> filter
        </span>
        {sep}
        {back}
        {sep}
        {close}
      </>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col">
      {/* Search input — same layout as CommandMenu */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <input
          ref={inputRef}
          type="text"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/60"
          placeholder={
            pickingBase ? `Select base for "${sanitizedName}"…` : 'Search or create new branch…'
          }
        />
        {query && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            className="cursor-pointer rounded px-1 text-text-muted transition-colors hover:text-text-primary"
          >
            <X size={11} />
          </button>
        )}
      </div>

      {/* Tab chips — only shown in normal (non-picker) mode */}
      {!pickingBase && !isCreateMode && (
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
          {(['all', 'worktrees'] as const).map((t) => (
            <button
              key={t}
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded px-2 py-0.5 text-[11px] capitalize transition-colors ${
                tab === t ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t === 'all' ? `All · ${branches.length}` : `Worktrees · ${diskWorktrees.length}`}
            </button>
          ))}
        </div>
      )}

      {/* Base picker header */}
      {pickingBase && (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setPickingBase(false)}
            className="flex cursor-pointer items-center gap-1 text-[11px] text-text-muted transition-colors hover:text-text-primary"
          >
            <ChevronLeft size={11} strokeWidth={1.5} />
            back
          </button>
          <span className="text-[11px] text-text-muted opacity-40">/</span>
          <span className="text-[11px] text-text-primary">
            base for <span className="text-accent">{sanitizedName}</span>
          </span>
        </div>
      )}

      {/* List — same structure and styling as CommandMenu */}
      <div ref={listRef} className="max-h-[340px] min-h-0 overflow-y-auto py-1">
        {sections.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-[13px] text-text-muted">
            {query ? `No results for "${query}"` : 'No branches'}
          </div>
        ) : (
          sections.map((sec) => (
            <div key={sec.id} role="presentation">
              {sec.label && (
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-text-muted uppercase opacity-60">
                  {sec.label}
                </div>
              )}
              {sec.items.map((item) => (
                <PaletteRow
                  key={item.id}
                  item={item}
                  isSelected={item.id === selectedId}
                  baseBranch={baseBranch}
                  pickingBase={pickingBase}
                  onMouseEnter={() => setSelectedId(item.id)}
                  onClick={() => handleActivate(item)}
                  onMouseDown={(e) => e.preventDefault()}
                />
              ))}
            </div>
          ))
        )}
      </div>

      {/* Footer hints */}
      <div className="flex shrink-0 items-center gap-2.5 border-t border-border bg-bg-primary/40 px-3 py-2 text-[11px] text-text-muted/60">
        {getFooterHint()}
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function PaletteRow({
  item,
  isSelected,
  baseBranch,
  pickingBase,
  onMouseEnter,
  onClick,
  onMouseDown,
}: {
  item: PaletteItem;
  isSelected: boolean;
  baseBranch: string;
  pickingBase: boolean;
  onMouseEnter: () => void;
  onClick: () => void;
  onMouseDown: (e: React.MouseEvent) => void;
}) {
  const isDisabled =
    item.kind === 'branch' && !pickingBase && (item.branch?.is_head || item.branch?.is_in_worktree);

  const isBasePicked = pickingBase && item.branch?.name === baseBranch;

  return (
    <div
      role="option"
      aria-selected={isSelected}
      data-id={item.id}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      onMouseDown={onMouseDown}
      className={`flex h-9 cursor-pointer items-center gap-2 px-3 text-[13px] text-text-primary ${
        isSelected ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50'
      } ${isDisabled ? 'opacity-50' : ''}`}
    >
      <PaletteIcon kind={item.kind} />

      {/* Label */}
      <span
        className={`flex-1 truncate ${item.kind === 'create' ? 'text-accent' : ''} ${isBasePicked ? 'font-medium' : ''}`}
      >
        {item.kind === 'create'
          ? `Create "${item.label ?? ''}"`
          : (item.branch?.name ?? item.worktree?.name ?? '')}
      </span>

      {/* Right side: badges + status */}
      {item.kind === 'create' && (
        <span className="shrink-0 text-[11px] text-text-muted">from {baseBranch}</span>
      )}

      {item.kind === 'branch' && item.branch && (
        <div className="flex shrink-0 items-center gap-1.5">
          <BranchMeta branch={item.branch} pickingBase={pickingBase} />
        </div>
      )}

      {item.kind === 'worktree' && item.worktree && (
        <span className="shrink-0 text-[11px] text-text-muted">
          {item.worktree.isInSidebar ? 'opened' : item.worktree.branch}
        </span>
      )}

      {/* Base picker check */}
      {isBasePicked && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--accent)" className="shrink-0">
          <path d="M6 10.8l-2.4-2.4L2 10l4 4 8-8-1.6-1.6z" />
        </svg>
      )}
    </div>
  );
}

// ── Branch metadata (badges + right-side status) ──────────────────────────────

function BranchMeta({
  branch,
  pickingBase,
}: {
  branch: NonNullable<PaletteItem['branch']>;
  pickingBase: boolean;
}) {
  if (pickingBase) {
    // In base picker, just show HEAD badge if applicable
    return branch.is_head ? (
      <Badge color="accent" size="sm">
        HEAD
      </Badge>
    ) : null;
  }

  return (
    <>
      {branch.is_head && (
        <Badge color="accent" size="sm">
          HEAD
        </Badge>
      )}
      {branch.is_local && !branch.is_head && (
        <Badge color="warning" size="sm">
          local
        </Badge>
      )}
      {!branch.is_local && <Badge size="sm">origin</Badge>}
      {branch.is_in_worktree && (
        <Badge color="error" size="sm">
          in worktree
        </Badge>
      )}
      {(branch.is_head || branch.is_in_worktree) && (
        <span className="shrink-0 text-[11px] text-text-muted">
          {branch.is_head ? 'checked out' : 'in use'}
        </span>
      )}
    </>
  );
}
