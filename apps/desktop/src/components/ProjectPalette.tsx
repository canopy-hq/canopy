import { memo, useCallback, useEffect, useRef } from 'react';

import {
  focusLater,
  FooterBar,
  FooterHint,
  FooterSep,
  Kbd,
  SectionHeader,
  useScrollSelectedIntoView,
} from '@canopy/command-palette';
import { Badge, Button } from '@canopy/ui';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  CornerDownLeft,
  Delete,
  GitBranch,
  GitFork,
  Plus,
  X,
} from 'lucide-react';
import { tv } from 'tailwind-variants';

import { useProjectPalette, type PaletteItem } from './useProjectPalette';

import type { PanelContext } from '@canopy/command-palette';
import type { Project } from '@canopy/db';

export interface ProjectPalettePanelProps {
  project: Project;
  ctx: PanelContext;
}

// ── Icon ───────────────────────────────────────────────────────────────────────

function PaletteIcon({ item }: { item: PaletteItem }) {
  const props = { size: 12, className: 'shrink-0 text-text-muted' } as const;
  if (item.kind === 'create') return <Plus {...props} className="shrink-0 text-accent" />;
  if (item.kind === 'branch') return <GitBranch {...props} />;
  if (item.kind === 'quick-base')
    return item.quickBaseAction === 'from-other' ? (
      <GitFork {...props} />
    ) : (
      <GitBranch {...props} />
    );
  return <GitFork {...props} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectPalettePanel({ project, ctx }: ProjectPalettePanelProps) {
  const {
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
    setSelectedId,
    branches,
    diskWorktrees,
    handleCreateWorktree,
    handleOpenWorktree,
  } = useProjectPalette(project, ctx);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on mount
  useEffect(() => {
    focusLater(inputRef);
  }, []);

  useScrollSelectedIntoView(listRef, selectedId);

  // Activate an item — dispatched by keyboard Enter and mouse click
  const handleActivate = useCallback(
    (item: PaletteItem) => {
      if (item.kind === 'create') {
        // Enter on "Create X" opens the quick base picker;
        // ⌘↩ (handled in handleKeyDown) bypasses it and creates immediately.
        setQuickBase(true);
        return;
      }
      if (item.kind === 'quick-base') {
        if (item.quickBaseAction === 'from-default') {
          handleCreateWorktree();
        } else {
          setQuickBase(false);
          setPickingBase(true);
        }
        return;
      }
      if (item.kind === 'branch') {
        if (!item.branch) return;
        if (pickingBase) {
          handleCreateWorktree({ base: item.branch.name });
          return;
        }
        if (item.branch.is_head || item.branch.is_in_worktree) return;
        handleCreateWorktree({ existingBranch: item.branch.name });
        return;
      }
      if (item.kind === 'worktree' && item.worktree && !item.worktree.isInSidebar) {
        handleOpenWorktree(item.worktree.name, item.worktree.path, item.worktree.branch);
      }
    },
    [pickingBase, handleCreateWorktree, handleOpenWorktree, setPickingBase, setQuickBase],
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
            handleCreateWorktree();
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
              setQuickBase(true);
            } else if (quickBase) {
              setQuickBase(false);
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
      quickBase,
      pickingBase,
      setSelectedId,
      setTab,
      setQuickBase,
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
      <FooterHint label="navigate">
        <Kbd variant="menu">
          <ArrowUp size={9} />
        </Kbd>
        <Kbd variant="menu">
          <ArrowDown size={9} />
        </Kbd>
      </FooterHint>
    );
    const back = (
      <FooterHint label="back">
        <Kbd variant="menu">
          <Delete size={9} />
        </Kbd>
      </FooterHint>
    );
    const tail = (
      <>
        <FooterSep />
        {back}
      </>
    );

    if (isCreateMode && !quickBase && !pickingBase) {
      return (
        <>
          {nav}
          <FooterSep />
          <FooterHint label="select base">
            <Kbd variant="menu">
              <CornerDownLeft size={9} />
            </Kbd>
          </FooterHint>
          {tail}
        </>
      );
    }
    if (quickBase || pickingBase) {
      return (
        <>
          {nav}
          {tail}
        </>
      );
    }
    if (selectedItem?.kind === 'branch') {
      const b = selectedItem.branch!;
      if (b.is_head || b.is_in_worktree) {
        return (
          <>
            {nav}
            <FooterSep />
            <span>{b.is_head ? 'checked out' : 'already in worktree'}</span>
            {tail}
          </>
        );
      }
      return (
        <>
          {nav}
          <FooterSep />
          <FooterHint label="create worktree">
            <Kbd variant="menu">
              <CornerDownLeft size={9} />
            </Kbd>
          </FooterHint>
          {tail}
        </>
      );
    }
    if (selectedItem?.kind === 'worktree') {
      return (
        <>
          {nav}
          <FooterSep />
          <FooterHint label={selectedItem.worktree?.isInSidebar ? 'already open' : 'open'}>
            <Kbd variant="menu">
              <CornerDownLeft size={9} />
            </Kbd>
          </FooterHint>
          {tail}
        </>
      );
    }
    return (
      <>
        {nav}
        <FooterSep />
        <FooterHint label="open">
          <Kbd variant="menu">
            <CornerDownLeft size={9} />
          </Kbd>
        </FooterHint>
        {tail}
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
          className="flex-1 bg-transparent text-base text-text-primary outline-none placeholder:text-text-muted/60"
          placeholder={
            pickingBase ? `Select base for "${sanitizedName}"…` : 'Search or create worktree…'
          }
        />
        {query && (
          <Button
            variant="ghost"
            iconOnly
            size="sm"
            onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
            onPress={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear"
          >
            <X size={11} />
          </Button>
        )}
      </div>

      {/* Command preview — shown when naming a new worktree */}
      {isCreateMode && !quickBase && !pickingBase && (
        <div className="flex min-w-0 items-center gap-1 border-b border-border px-3 py-1.5 font-mono text-sm text-text-muted/60">
          <span className="shrink-0">git worktree add -b</span>
          <span className="max-w-[140px] min-w-0 truncate text-accent">{sanitizedName}</span>
          <span className="shrink-0">…</span>
          <span className="max-w-[140px] min-w-0 truncate">{baseBranch}</span>
        </div>
      )}

      {/* Tab chips — only shown in normal (non-picker) mode */}
      {!quickBase && !pickingBase && !isCreateMode && (
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
          {(['all', 'worktrees'] as const).map((t) => (
            <button
              key={t}
              type="button"
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded px-2 py-0.5 text-sm capitalize transition-colors ${
                tab === t ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {t === 'all' ? `All · ${branches.length}` : `Worktrees · ${diskWorktrees.length}`}
            </button>
          ))}
        </div>
      )}

      {/* Quick base / full base picker header */}
      {(quickBase || pickingBase) && (
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
          <Button
            variant="link"
            onMouseDown={(e: React.MouseEvent) => e.preventDefault()}
            onPress={() => {
              if (pickingBase) {
                setPickingBase(false);
                setQuickBase(true);
              } else {
                setQuickBase(false);
              }
            }}
            className="flex cursor-pointer items-center gap-1 text-sm"
          >
            <ChevronLeft size={11} />
            back
          </Button>
          <span className="text-sm text-text-muted opacity-40">/</span>
          <span className="text-sm text-text-primary">
            base for <span className="text-accent">{sanitizedName}</span>
          </span>
        </div>
      )}

      {/* List — same structure and styling as CommandMenu */}
      <div ref={listRef} className="max-h-[340px] min-h-0 overflow-y-auto py-1">
        {sections.length === 0 ? (
          <div className="flex items-center justify-center py-8 font-mono text-sm text-text-faint">
            {query ? `No results for "${query}"` : 'No branches'}
          </div>
        ) : (
          sections.map((sec) => (
            <div key={sec.id} role="presentation">
              {sec.label && <SectionHeader label={sec.label} />}
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

      <FooterBar>{getFooterHint()}</FooterBar>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

const paletteRow = tv({
  base: 'flex h-9 cursor-pointer items-center gap-2 px-3 text-base text-text-primary',
  variants: {
    selected: { true: 'bg-bg-tertiary', false: 'hover:bg-bg-tertiary/50' },
    disabled: { true: 'opacity-50' },
  },
});

const paletteLabel = tv({
  base: 'flex-1 truncate',
  variants: { create: { true: 'text-accent' }, basePicked: { true: 'font-medium' } },
});

const PaletteRow = memo(
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
      item.kind === 'branch' &&
      !pickingBase &&
      (item.branch?.is_head || item.branch?.is_in_worktree);

    const isBasePicked = pickingBase && item.branch?.name === baseBranch;

    return (
      <div
        role="option"
        aria-selected={isSelected}
        data-id={item.id}
        onMouseEnter={onMouseEnter}
        onClick={onClick}
        onMouseDown={onMouseDown}
        className={paletteRow({ selected: isSelected, disabled: isDisabled })}
      >
        <PaletteIcon item={item} />

        {/* Label */}
        <span
          className={paletteLabel({ create: item.kind === 'create', basePicked: isBasePicked })}
        >
          {item.kind === 'create'
            ? `Create "${item.label ?? ''}"`
            : item.kind === 'quick-base'
              ? item.quickBaseAction === 'from-default'
                ? `from ${item.label}`
                : item.label
              : (item.branch?.name ?? item.worktree?.name ?? '')}
        </span>

        {/* Right side: badges + status */}
        {item.kind === 'create' && (
          <span className="shrink-0 text-sm text-text-muted">from {baseBranch}</span>
        )}

        {item.kind === 'branch' && item.branch && (
          <div className="flex shrink-0 items-center gap-1.5">
            <BranchMeta branch={item.branch} pickingBase={pickingBase} />
          </div>
        )}

        {item.kind === 'worktree' && item.worktree && (
          <span className="shrink-0 text-sm text-text-muted">
            {item.worktree.isInSidebar ? 'opened' : item.worktree.branch}
          </span>
        )}

        {/* Base picker check */}
        {isBasePicked && <Check size={12} className="shrink-0 text-accent" />}
      </div>
    );
  },
  (prev, next) =>
    prev.item === next.item &&
    prev.isSelected === next.isSelected &&
    prev.baseBranch === next.baseBranch &&
    prev.pickingBase === next.pickingBase,
);

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
      <Badge color="accent" size="xs">
        HEAD
      </Badge>
    ) : null;
  }

  return (
    <>
      {branch.is_head ? (
        <Badge color="accent" size="xs">
          checked out
        </Badge>
      ) : branch.is_in_worktree ? (
        <Badge color="warning" size="xs">
          in worktree
        </Badge>
      ) : branch.is_local ? (
        <Badge color="neutral" size="xs">
          local
        </Badge>
      ) : (
        <Badge size="xs">origin</Badge>
      )}
    </>
  );
}
