import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  horizontalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, X } from 'lucide-react';
import { tv } from 'tailwind-variants';

import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import { addTab, closeTab, switchTab, renameTab, reorderTabs } from '../lib/tab-actions';
import { StatusDot } from './StatusDot';
import { Button, Kbd, Tooltip } from './ui';

import type { DotStatus } from './StatusDot';
import type { Tab } from '@superagent/db';

const closeTabLabel = (
  <>
    Close Tab <Kbd>⌘W</Kbd>
  </>
);

const newTabLabel = (
  <>
    New Tab <Kbd>⌘T</Kbd>
  </>
);

const tabItem = tv({
  base: 'group relative flex h-full max-w-[240px] min-w-[120px] shrink items-center gap-1.5 px-3 transition-colors',
  variants: {
    active: {
      true: 'bg-bg-secondary text-text-primary shadow-[inset_0_-3px_0_var(--accent)]',
      false: 'bg-transparent text-text-muted hover:bg-bg-secondary hover:text-text-secondary',
    },
    agentWaiting: { true: 'bg-(--agent-waiting-glow)' },
  },
  defaultVariants: { active: false, agentWaiting: false },
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
    });
    const agentStatus = useTabAgentStatus(tab);
    const [editing, setEditing] = useState(false);
    const [frozenWidth, setFrozenWidth] = useState<number | null>(null);
    const [draft, setDraft] = useState('');
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const originalLabelRef = useRef('');
    const committedRef = useRef(false);

    const mergedRef = useCallback(
      (node: HTMLButtonElement | null) => {
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
      touchAction: 'none',
    };

    return (
      <button
        ref={mergedRef}
        className={`${tabItem({ active: isActive, agentWaiting: agentStatus === 'waiting' })}${isDragging ? ' pointer-events-none relative z-50 bg-bg-primary' : ''}`}
        style={
          frozenWidth !== null
            ? { ...dndStyle, width: frozenWidth, minWidth: frozenWidth, maxWidth: frozenWidth }
            : dndStyle
        }
        onClick={editing ? undefined : () => switchTab(tab.id)}
        onMouseDown={(e) => {
          if (e.button === 1) {
            e.preventDefault();
            void handleClose();
          }
        }}
        title={tab.label}
        {...listeners}
        {...attributes}
      >
        {agentStatus !== 'idle' && !editing && <StatusDot status={agentStatus} size={8} />}
        {editing ? (
          <input
            ref={inputRef}
            className="w-full min-w-0 bg-transparent text-md text-text-primary outline-none"
            value={draft}
            maxLength={20}
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
          <span
            className="flex-1 truncate text-left text-md"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            {tab.label}
          </span>
        )}
        {agentStatus === 'waiting' && !editing && (
          <span className="rounded-full bg-[rgba(251,191,36,0.25)] px-2 py-1 text-xs leading-none font-normal text-(--agent-waiting)">
            input
          </span>
        )}
        {!editing && (
          <Tooltip label={closeTabLabel} placement="bottom">
            <Button
              elementType="span"
              iconOnly
              variant="ghost"
              tabIndex={-1}
              className={closeButton({ active: isActive })}
              onPress={() => void handleClose()}
            >
              <X size={10} strokeWidth={2} />
            </Button>
          </Tooltip>
        )}
      </button>
    );
  },
  (prev, next) => prev.tab === next.tab && prev.isActive === next.isActive,
);

const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });

export function TabBar() {
  const allTabs = useTabs();
  const ui = useUiState();
  const activeContextId = ui.activeContextId;
  const tabs = useMemo(
    () =>
      allTabs
        .filter((t) => t.workspaceItemId === activeContextId)
        .sort((a, b) => a.position - b.position),
    [allTabs, activeContextId],
  );
  const activeTabId = ui.activeTabId;
  const [dragging, setDragging] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!dragging) return;
    const style = document.createElement('style');
    style.textContent = '* { cursor: grabbing !important; pointer-events: none !important; }';
    document.head.appendChild(style);
    return () => style.remove();
  }, [dragging]);

  const handleDragEnd = useCallback(
    ({ active, over }: DragEndEvent) => {
      setDragging(false);
      if (!over || active.id === over.id) return;
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      const reordered = arrayMove(tabs, oldIndex, newIndex);
      reorderTabs(reordered.map((t) => t.id));
    },
    [tabs],
  );

  const tabIds = useMemo(() => tabs.map((t) => t.id), [tabs]);

  const scrollRef = useRef<HTMLDivElement>(null);
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

  return (
    <div className="flex h-9 shrink-0 items-center border-b border-border bg-bg-primary">
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
      <Tooltip label={newTabLabel} placement="bottom">
        <Button
          iconOnly
          size="sm"
          variant="ghost"
          onPress={addTab}
          aria-label="New Tab"
          className="mx-1 shrink-0"
        >
          <Plus size={14} strokeWidth={1.5} />
        </Button>
      </Tooltip>
    </div>
  );
}
