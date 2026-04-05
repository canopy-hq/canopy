import { useCallback, useEffect, useRef } from 'react';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';

import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Command,
  CornerDownLeft,
  Cpu,
  Delete,
  FolderGit2,
  GitBranch,
  GitFork,
  PanelLeft,
  Plus,
  Settings,
  X,
} from 'lucide-react';

import { useCommandMenu, type MenuSection } from './useCommandMenu';

import type { CommandContext, CommandItem, CommandMenuProps, PanelContext } from './types';

const SECTION_CYCLE: MenuSection[] = ['root', 'projects', 'tabs', 'pty', 'agents'];

// ── Kbd ────────────────────────────────────────────────────────────────────────

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center gap-0.5 rounded border border-border/60 bg-bg-primary px-1 py-0.5 text-[10px] leading-none text-text-muted">
      {children}
    </kbd>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────

function ItemIcon({ icon }: { icon: CommandItem['icon'] }) {
  const props = { size: 12, strokeWidth: 1.5, className: 'shrink-0 text-text-muted' } as const;
  switch (icon) {
    case 'folder':
      return <FolderGit2 {...props} />;
    case 'branch':
      return <GitBranch {...props} />;
    case 'worktree':
      return <GitFork {...props} />;
    case 'tab':
      return <ChevronRight {...props} />;
    case 'agent':
      return <Cpu {...props} />;
    case 'settings':
      return <Settings {...props} />;
    case 'sidebar':
      return <PanelLeft {...props} />;
    case 'plus':
      return <Plus {...props} />;
    case 'x':
      return <X {...props} />;
    default:
      return <span className="w-3 shrink-0" />;
  }
}

// ── Status dot ─────────────────────────────────────────────────────────────────

function agentDotColor(status: NonNullable<CommandItem['agentStatus']>): string {
  switch (status) {
    case 'running':
      return 'bg-(--agent-running)';
    case 'waiting':
      return 'bg-(--agent-waiting)';
    default:
      return 'bg-text-muted/40';
  }
}

function AgentDot({ status }: { status: NonNullable<CommandItem['agentStatus']> }) {
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${agentDotColor(status)}`} />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CommandMenu({
  isOpen,
  onClose,
  items,
  activeContextId,
  defaultPanelItem,
}: CommandMenuProps) {
  const { query, section, drillStack, panelItem, selectedId, dispatch, sections, flatItems } =
    useCommandMenu(items, activeContextId);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Use a ref so the open effect always reads the latest defaultPanelItem without
  // re-firing when the prop changes while the menu is already open.
  const defaultPanelItemRef = useRef(defaultPanelItem);
  defaultPanelItemRef.current = defaultPanelItem;

  useEffect(() => {
    if (isOpen) {
      if (defaultPanelItemRef.current) {
        dispatch({ type: 'OPEN_PANEL', item: defaultPanelItemRef.current });
      } else {
        dispatch({ type: 'RESET' });
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, dispatch]);

  // Re-focus input when returning from a panel (panelItem goes truthy → null)
  const prevPanelItemRef = useRef(panelItem);
  useEffect(() => {
    const prev = prevPanelItemRef.current;
    prevPanelItemRef.current = panelItem;
    if (isOpen && prev !== null && panelItem === null) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, panelItem]);

  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector<HTMLLIElement>(`[data-id="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const handleAction = useCallback(
    (item: CommandItem) => {
      if (item.renderPanel) {
        dispatch({ type: 'OPEN_PANEL', item });
        return;
      }
      if (item.children) {
        dispatch({ type: 'DRILL_INTO', item });
        requestAnimationFrame(() => inputRef.current?.focus());
        return;
      }
      const ctx: CommandContext = { close: onClose };
      onClose();
      void item.action(ctx);
    },
    [dispatch, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const idx = flatItems.findIndex((i) => i.id === selectedId);
          const next = flatItems.length > 0 ? flatItems[(idx + 1) % flatItems.length] : null;
          if (next) dispatch({ type: 'SET_SELECTED', id: next.id });
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const idx = flatItems.findIndex((i) => i.id === selectedId);
          const prev =
            flatItems.length > 0
              ? flatItems[(idx - 1 + flatItems.length) % flatItems.length]
              : null;
          if (prev) dispatch({ type: 'SET_SELECTED', id: prev.id });
          break;
        }
        case 'Enter': {
          e.preventDefault();
          const item = flatItems.find((i) => i.id === selectedId);
          if (item) handleAction(item);
          break;
        }
        case 'Escape': {
          e.preventDefault();
          onClose();
          break;
        }
        case 'Tab': {
          e.preventDefault();
          const idx = SECTION_CYCLE.indexOf(section);
          const next = e.shiftKey
            ? SECTION_CYCLE[(idx - 1 + SECTION_CYCLE.length) % SECTION_CYCLE.length]!
            : SECTION_CYCLE[(idx + 1) % SECTION_CYCLE.length]!;
          dispatch({ type: 'SET_SECTION', section: next });
          break;
        }
        case 'Backspace': {
          if (query === '') {
            e.preventDefault();
            if (drillStack.length > 0) {
              dispatch({ type: 'DRILL_BACK' });
            } else if (section !== 'root') {
              dispatch({ type: 'SET_SECTION', section: 'root' });
            }
          }
          break;
        }
      }
    },
    [flatItems, selectedId, query, drillStack, section, dispatch, handleAction, onClose],
  );

  const panelCtx: PanelContext = { close: onClose, back: () => dispatch({ type: 'CLOSE_PANEL' }) };

  const panelWsItem =
    panelItem && drillStack.length === 0 && panelItem.contextId
      ? (items.find(
          (i) => i.category === 'workspace' && i.id === `workspace:${panelItem.contextId}`,
        ) ?? null)
      : null;

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      isKeyboardDismissDisabled
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[120px]"
    >
      <Modal
        className="flex max-h-[70vh] w-[600px] flex-col overflow-hidden rounded-xl border border-border font-mono shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        style={{
          background: 'color-mix(in srgb, var(--bg-secondary) 85%, transparent)',
          WebkitBackdropFilter: 'blur(12px)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Dialog
          className="flex min-h-0 flex-1 flex-col overflow-hidden outline-none"
          aria-label="Command Menu"
        >
          {panelItem ? (
            <>
              {/* Panel breadcrumb — shows drillStack context + panel item */}
              <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-[11px] text-text-muted">
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => dispatch({ type: 'RESET' })}
                  className="cursor-pointer transition-colors hover:text-text-primary"
                >
                  root
                </button>
                {drillStack.map((crumb, i) => (
                  <span key={crumb.id} className="flex items-center gap-1">
                    <span className="opacity-40">/</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => dispatch({ type: 'DRILL_INTO', item: drillStack[i]! })}
                      className="cursor-pointer transition-colors hover:text-text-primary"
                    >
                      {crumb.label}
                    </button>
                  </span>
                ))}
                {panelWsItem && (
                  <span className="flex items-center gap-1">
                    <span className="opacity-40">/</span>
                    <button
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        dispatch({ type: 'CLOSE_PANEL' });
                        dispatch({ type: 'DRILL_INTO', item: panelWsItem });
                      }}
                      className="cursor-pointer transition-colors hover:text-text-primary"
                    >
                      {panelWsItem.label}
                    </button>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="opacity-40">/</span>
                  <span className="text-text-primary">{panelItem.label}</span>
                </span>
              </div>

              {/* Panel content */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {panelItem.renderPanel!(panelCtx)}
              </div>
            </>
          ) : (
            <>
              {/* Breadcrumb — always visible */}
              <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-[11px] text-text-muted">
                {drillStack.length === 0 ? (
                  <span className="text-text-primary">root</span>
                ) : (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => dispatch({ type: 'RESET' })}
                    className="cursor-pointer transition-colors hover:text-text-primary"
                  >
                    root
                  </button>
                )}
                {drillStack.map((crumb, i) => (
                  <span key={crumb.id} className="flex items-center gap-1">
                    <span className="opacity-40">/</span>
                    {i === drillStack.length - 1 ? (
                      <span className="text-text-primary">{crumb.label}</span>
                    ) : (
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => dispatch({ type: 'DRILL_INTO', item: drillStack[i]! })}
                        className="cursor-pointer transition-colors hover:text-text-primary"
                      >
                        {crumb.label}
                      </button>
                    )}
                  </span>
                ))}
              </div>

              {/* Search input */}
              <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                <Kbd>
                  <Command size={9} />K
                </Kbd>
                <input
                  ref={inputRef}
                  type="text"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={query}
                  onChange={(e) => dispatch({ type: 'SET_QUERY', query: e.target.value })}
                  onKeyDown={handleKeyDown}
                  className="flex-1 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-text-muted/60"
                  placeholder={
                    drillStack.length > 0
                      ? `Search in ${drillStack[drillStack.length - 1]!.label}…`
                      : section !== 'root'
                        ? `Search in ${section}…`
                        : 'Search commands, workspaces, tabs…'
                  }
                />
                {query && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => {
                      dispatch({ type: 'SET_QUERY', query: '' });
                      inputRef.current?.focus();
                    }}
                    aria-label="Clear"
                    className="cursor-pointer rounded px-1 text-text-muted transition-colors hover:text-text-primary"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>

              {/* Section tabs */}
              {section !== 'root' && drillStack.length === 0 && (
                <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
                  {SECTION_CYCLE.map((s) => (
                    <button
                      key={s}
                      type="button"
                      tabIndex={-1}
                      onClick={() => {
                        dispatch({ type: 'SET_SECTION', section: s });
                        inputRef.current?.focus();
                      }}
                      className={`cursor-pointer rounded px-2 py-0.5 text-[11px] capitalize transition-colors ${
                        section === s
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-muted hover:text-text-primary'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              {/* Command list */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                {sections.length === 0 ? (
                  <div className="flex items-center justify-center py-8 text-[13px] text-text-muted">
                    No results
                  </div>
                ) : (
                  <ul ref={listRef} role="listbox" aria-label="Commands" className="py-1">
                    {sections.map((sec) => (
                      <li key={sec.id} role="presentation">
                        {sec.label && (
                          <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted opacity-60">
                            {sec.label}
                          </div>
                        )}
                        <ul role="group">
                          {sec.items.map((item) => {
                            const isSelected = item.id === selectedId;
                            return (
                              <li
                                key={item.id}
                                role="option"
                                aria-selected={isSelected}
                                data-id={item.id}
                                onClick={() => handleAction(item)}
                                onMouseEnter={() => dispatch({ type: 'SET_SELECTED', id: item.id })}
                                className={`flex h-9 cursor-pointer items-center gap-2 px-3 text-[13px] text-text-primary outline-none ${
                                  isSelected ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/50'
                                }`}
                              >
                                <ItemIcon icon={item.icon} />
                                <span className="flex-1 truncate">{item.label}</span>
                                {item.agentStatus && <AgentDot status={item.agentStatus} />}
                                {item.shortcut && <Kbd>{item.shortcut}</Kbd>}
                                {(item.children || item.renderPanel) && (
                                  <ChevronRight
                                    size={13}
                                    strokeWidth={1.5}
                                    className="shrink-0 text-text-muted opacity-50"
                                  />
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Footer hints */}
              <div className="flex shrink-0 items-center gap-2.5 border-t border-border bg-bg-primary/40 px-3 py-2 text-[11px] text-text-muted/60">
                <span className="flex items-center gap-1">
                  <Kbd>
                    <ArrowUp size={9} />
                  </Kbd>
                  <Kbd>
                    <ArrowDown size={9} />
                  </Kbd>
                  navigate
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Kbd>
                    <CornerDownLeft size={9} />
                  </Kbd>{' '}
                  open
                </span>
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Kbd>Tab</Kbd> filter
                </span>
                {(drillStack.length > 0 || section !== 'root') && (
                  <>
                    <span>·</span>
                    <span className="flex items-center gap-1">
                      <Kbd>
                        <Delete size={9} />
                      </Kbd>{' '}
                      back
                    </span>
                  </>
                )}
                <span>·</span>
                <span className="flex items-center gap-1">
                  <Kbd>Esc</Kbd> close
                </span>
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
