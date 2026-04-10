import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';

import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge, Button, Kbd, StatusDot, Tooltip } from '@superagent/ui';
import { ContextMenu } from '@superagent/ui';
import { Pencil, SquarePlus, SquareTerminal, X, XCircle, XSquare } from 'lucide-react';
import { tv } from 'tailwind-variants';

import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { useDragStyle } from '../hooks/useDragStyle';
import { useDropping } from '../hooks/useDropping';
import { useFlipAnimation } from '../hooks/useFlipAnimation';
import { restrictToHorizontalAxis, sortableTransition, useDragSensors } from '../lib/dnd';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import {
  closeTab,
  switchTab,
  renameTab,
  reorderTabs,
  closeAllTabs,
  closeAllTabsExcept,
  addTab,
  addClaudeCodeTab,
} from '../lib/tab-actions';
import { ClaudeCodeIcon } from './ClaudeCodeIcon';

import type { Tab } from '@superagent/db';
import type { DotStatus } from '@superagent/ui';

const closeTabLabel = (
  <>
    Close Tab <Kbd>⌘W</Kbd>
  </>
);

const tabItem = tv({
  base: 'group relative flex h-full max-w-[240px] min-w-[120px] shrink items-center gap-2 px-3.5 transition-colors touch-none',
  variants: {
    active: {
      true: 'bg-bg-primary text-text-primary',
      false: 'bg-transparent text-text-muted hover:bg-bg-primary/50 hover:text-text-secondary',
    },
    agentWaiting: { true: 'bg-(--agent-waiting-glow)' },
    dragging: { true: 'pointer-events-none z-50 bg-bg-primary' },
  },
  defaultVariants: { active: false, agentWaiting: false, dragging: false },
});

const closeButton = tv({
  base: 'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm hover:bg-bg-tertiary [will-change:opacity]',
  variants: {
    active: {
      true: 'opacity-60 hover:opacity-100',
      false: 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
    },
  },
});

function useTabAgentStatus(tab: Tab): DotStatus {
  const ptyIds = useMemo(() => collectLeafPtyIds(tab.paneRoot), [tab.paneRoot]);
  const agents = useAgents();
  let hasRunning = false;
  for (const id of ptyIds) {
    const status = agents.find((a) => a.ptyId === id)?.status;
    if (status === 'waiting') return 'waiting';
    if (status === 'running') hasRunning = true;
  }
  return hasRunning ? 'running' : 'idle';
}

const TabItemComponent = memo(
  function TabItemComponent({ tab, isActive }: { tab: Tab; isActive: boolean }) {
    const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
      id: tab.id,
      transition: sortableTransition,
    });
    const isDropping = useDropping(isDragging, 220);
    const agentStatus = useTabAgentStatus(tab);
    const [editing, setEditing] = useState(false);
    const [frozenWidth, setFrozenWidth] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const buttonRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const originalLabelRef = useRef('');
    const committedRef = useRef(false);

    const mergedRef = useCallback(
      (node: HTMLDivElement | null) => {
        setNodeRef(node);
        buttonRef.current = node;
      },
      [setNodeRef],
    );

    useEffect(() => {
      if (isActive && !isDragging) {
        buttonRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }, [isActive, isDragging]);

    const startEditing = useCallback(() => {
      committedRef.current = false;
      originalLabelRef.current = tab.label;
      setFrozenWidth(buttonRef.current?.offsetWidth ?? null);
      setDraft(tab.label);
      setEditing(true);
    }, [tab.label]);

    useEffect(() => {
      if (editing) inputRef.current?.select();
    }, [editing]);

    const confirmRename = useCallback(() => {
      if (committedRef.current) return;
      committedRef.current = true;
      const trimmed = draft.trim();
      if (trimmed) renameTab(tab.id, trimmed, true);
      setEditing(false);
      setFrozenWidth(null);
    }, [draft, tab.id]);

    const cancelRename = useCallback(() => {
      committedRef.current = false;
      setEditing(false);
      setFrozenWidth(null);
    }, []);

    const handleBlur = useCallback(() => {
      if (draft.trim() !== originalLabelRef.current) {
        confirmRename();
      } else {
        cancelRename();
      }
    }, [draft, confirmRename, cancelRename]);

    const handleClose = useCallback(() => {
      closeTab(tab.id);
    }, [tab]);

    const dndStyle: React.CSSProperties = {
      transform: CSS.Transform.toString(transform ? { ...transform, scaleX: 1, scaleY: 1 } : null),
      transition,
    };

    return (
      <>
        <div
          ref={mergedRef}
          data-flip-id={tab.id}
          className={tabItem({
            active: isActive,
            agentWaiting: agentStatus === 'waiting',
            dragging: isDragging || isDropping,
          })}
          style={
            frozenWidth !== null
              ? { ...dndStyle, width: frozenWidth, minWidth: frozenWidth, maxWidth: frozenWidth }
              : dndStyle
          }
          onClick={editing ? undefined : () => switchTab(tab.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setContextMenu({ x: e.clientX, y: e.clientY });
          }}
          onMouseDown={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              handleClose();
            }
          }}
          {...listeners}
          {...attributes}
        >
          {agentStatus !== 'idle' && !editing && <StatusDot status={agentStatus} size={8} />}
          {editing ? (
            <input
              ref={inputRef}
              className="w-full min-w-0 bg-transparent font-mono text-md text-text-primary outline-none"
              value={draft}
              maxLength={20}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  confirmRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelRename();
                } else {
                  e.stopPropagation();
                }
              }}
              onBlur={handleBlur}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <>
              {tab.icon === 'claude-code' && (
                <ClaudeCodeIcon size={12} className="shrink-0 text-[#da7756]" />
              )}
              <span
                className="flex-1 truncate text-left font-mono text-md"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  startEditing();
                }}
              >
                {tab.label}
              </span>
            </>
          )}
          {agentStatus === 'waiting' && !editing && (
            <Badge pill color="warning" size="xs">
              input
            </Badge>
          )}
          {!editing && (
            <Tooltip label={closeTabLabel} placement="bottom">
              <AriaButton
                aria-label="Close tab"
                className={closeButton({ active: isActive || isDragging || isDropping })}
                onPointerDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleClose();
                }}
              >
                <X size={10} />
              </AriaButton>
            </Tooltip>
          )}
        </div>
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            items={[
              {
                type: 'action',
                label: 'Rename',
                icon: <Pencil size={13} />,
                onSelect: () => {
                  setContextMenu(null);
                  startEditing();
                },
              },
              {
                type: 'action',
                label: 'Close',
                icon: <X size={13} />,
                onSelect: () => {
                  setContextMenu(null);
                  closeTab(tab.id);
                },
              },
              {
                type: 'action',
                label: 'Close all',
                icon: <XSquare size={13} />,
                onSelect: () => {
                  setContextMenu(null);
                  closeAllTabs(tab.projectItemId);
                },
              },
              {
                type: 'action',
                label: 'Close others',
                icon: <XCircle size={13} />,
                onSelect: () => {
                  setContextMenu(null);
                  closeAllTabsExcept(tab.id);
                },
              },
            ]}
          />
        )}
      </>
    );
  },
  (prev, next) => prev.tab === next.tab && prev.isActive === next.isActive,
);

export function TabBar() {
  const allTabs = useTabs();
  const ui = useUiState();
  const activeContextId = ui.activeContextId;
  const tabs = useMemo(
    () =>
      allTabs
        .filter((t) => t.projectItemId === activeContextId)
        .sort((a, b) => a.position - b.position),
    [allTabs, activeContextId],
  );
  const activeTabId = ui.activeTabId;
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sensors = useDragSensors();
  useDragStyle(dragging);
  const { snapshot: flipSnapshot } = useFlipAnimation(scrollRef, 'horizontal');

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      // Snapshot before any state update — DOM still has dnd-kit transforms here.
      flipSnapshot();
      setDragging(false);
      if (!over || active.id === over.id) return;
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      const reordered = arrayMove(tabs, oldIndex, newIndex);
      reorderTabs(reordered.map((t) => t.id));
    },
    [tabs, flipSnapshot],
  );

  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const [scrollState, setScrollState] = useState<{ left: boolean; right: boolean }>({
    left: false,
    right: false,
  });

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const hasOverflow = el.scrollWidth > el.clientWidth;
    setScrollState({
      left: hasOverflow && el.scrollLeft > 0,
      right: hasOverflow && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState, { passive: true });
    let rafId: number | null = null;
    const ro = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        rafId = null;
        updateScrollState();
      });
    });
    ro.observe(el);
    updateScrollState();
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [updateScrollState]);

  // Update scroll state when tabs change
  useEffect(() => {
    updateScrollState();
  }, [tabs.length, updateScrollState]);

  if (tabs.length === 0) return null;

  // Build CSS mask for scroll fade
  let maskImage = 'none';
  if (scrollState.left && scrollState.right) {
    maskImage =
      'linear-gradient(to right, transparent, black 24px, black calc(100% - 24px), transparent)';
  } else if (scrollState.left) {
    maskImage = 'linear-gradient(to right, transparent, black 24px)';
  } else if (scrollState.right) {
    maskImage = 'linear-gradient(to right, black calc(100% - 24px), transparent)';
  }

  const projectId = activeContextId ?? '';

  return (
    <div className="flex h-10 shrink-0 items-center border-b border-border/20 bg-bg-secondary">
      <MenuTrigger>
        <Button aria-label="New tab" size="sm" variant="ghost" iconOnly className="mx-2">
          <SquarePlus size={14} />
        </Button>
        <Popover
          placement="bottom start"
          offset={4}
          className="entering:animate-in entering:fade-in entering:zoom-in-95 exiting:animate-out exiting:fade-out exiting:zoom-out-95 w-max rounded-lg border border-border/60 bg-bg-secondary py-1 shadow-lg outline-none"
        >
          <Menu
            className="outline-none"
            onAction={(key) => {
              if (key === 'terminal') addTab(projectId);
              if (key === 'claude-code') addClaudeCodeTab(projectId);
            }}
          >
            <MenuItem
              id="terminal"
              className="flex cursor-default items-center gap-2 px-3 py-1.5 font-mono text-base text-text-secondary outline-none data-[focused]:bg-bg-tertiary"
            >
              <SquareTerminal size={12} className="shrink-0" />
              <span className="flex-1">New terminal</span>
              <Kbd>⌘T</Kbd>
            </MenuItem>
            <MenuItem
              id="claude-code"
              className="flex cursor-default items-center gap-2 px-3 py-1.5 font-mono text-base text-text-secondary outline-none data-[focused]:bg-bg-tertiary"
            >
              <ClaudeCodeIcon size={12} className="shrink-0 text-[#da7756]" />
              <span className="flex-1">Claude Code</span>
            </MenuItem>
          </Menu>
        </Popover>
      </MenuTrigger>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToHorizontalAxis]}
        onDragStart={() => setDragging(true)}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragging(false)}
      >
        <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
          <div
            ref={scrollRef}
            className="scrollbar-none flex h-full min-w-0 flex-1 items-stretch overflow-x-auto"
            style={{ maskImage, WebkitMaskImage: maskImage }}
          >
            {tabs.map((tab) => (
              <TabItemComponent key={tab.id} tab={tab} isActive={tab.id === activeTabId} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
