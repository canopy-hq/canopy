import { useCallback, useEffect, useRef, useState } from 'react';

import { closePty, disposeCached } from '@superagent/terminal';
import { tv } from 'tailwind-variants';

import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import { addTab, closeTab, switchTab, renameTab } from '../lib/tab-actions';
import { StatusDot } from './StatusDot';

import type { DotStatus } from './StatusDot';
import type { Tab } from '@superagent/db';

const tabItem = tv({
  base: 'group relative flex h-full max-w-[240px] min-w-[120px] shrink cursor-pointer items-center gap-1.5 rounded-t-md border-t-2 px-3 transition-colors',
  variants: {
    active: {
      true: 'border-t-accent bg-tab-active-bg text-text-primary',
      false: 'border-t-transparent bg-tab-inactive-bg text-text-muted hover:bg-bg-secondary',
    },
    agentWaiting: { true: 'bg-(--agent-waiting-glow)' },
  },
  defaultVariants: { active: false, agentWaiting: false },
});

const closeButton = tv({
  base: 'flex h-4 w-4 items-center justify-center rounded-sm text-[10px] leading-none hover:bg-bg-tertiary',
  variants: {
    active: {
      true: 'opacity-60 hover:opacity-100',
      false: 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
    },
  },
});

function useTabAgentStatus(tab: Tab): DotStatus {
  const ptyIds = collectLeafPtyIds(tab.paneRoot);
  const agents = useAgents();
  for (const id of ptyIds) {
    const agent = agents.find((a) => a.ptyId === id);
    if (agent?.status === 'waiting') return 'waiting';
  }
  for (const id of ptyIds) {
    const agent = agents.find((a) => a.ptyId === id);
    if (agent?.status === 'running') return 'running';
  }
  return 'idle';
}

function TabItemComponent({
  tab,
  isActive,
  onSwitch,
  onClose,
}: {
  tab: Tab;
  isActive: boolean;
  onSwitch: () => void;
  onClose: () => void;
}) {
  const agentStatus = useTabAgentStatus(tab);
  const [editing, setEditing] = useState(false);
  const [frozenWidth, setFrozenWidth] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const originalLabelRef = useRef('');

  useEffect(() => {
    if (isActive) buttonRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [isActive]);

  const startEditing = useCallback(() => {
    originalLabelRef.current = tab.label;
    setFrozenWidth(buttonRef.current?.offsetWidth ?? null);
    setDraft(tab.label);
    setEditing(true);
  }, [tab.label]);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const confirmRename = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed) renameTab(tab.id, trimmed, true);
    setEditing(false);
    setFrozenWidth(null);
  }, [draft, tab.id]);

  const cancelRename = useCallback(() => {
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

  return (
    <button
      ref={buttonRef}
      className={tabItem({ active: isActive, agentWaiting: agentStatus === 'waiting' })}
      style={
        frozenWidth !== null
          ? { width: frozenWidth, minWidth: frozenWidth, maxWidth: frozenWidth }
          : undefined
      }
      onClick={editing ? undefined : onSwitch}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
          onClose();
        }
      }}
      title={editing ? undefined : tab.label}
    >
      {agentStatus !== 'idle' && !editing && <StatusDot status={agentStatus} size={8} />}
      {editing ? (
        <input
          ref={inputRef}
          className="w-full min-w-0 bg-transparent text-xs text-text-primary outline-none"
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
          className="flex-1 truncate text-left text-xs"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEditing();
          }}
        >
          {tab.label}
        </span>
      )}
      {agentStatus === 'waiting' && !editing && (
        <span className="rounded-full bg-[rgba(251,191,36,0.25)] px-2 py-1 text-[10px] leading-none font-normal text-(--agent-waiting)">
          input
        </span>
      )}
      {!editing && (
        <span
          role="button"
          tabIndex={-1}
          className={closeButton({ active: isActive })}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.stopPropagation();
              onClose();
            }
          }}
        >
          x
        </span>
      )}
    </button>
  );
}

export function TabBar() {
  const allTabs = useTabs();
  const ui = useUiState();
  const activeContextId = ui.activeContextId;
  const tabs = allTabs
    .filter((t) => t.workspaceItemId === activeContextId)
    .sort((a, b) => a.position - b.position);
  const activeTabId = ui.activeTabId;

  const handleClose = useCallback(async (tab: Tab) => {
    const ptyIds = collectLeafPtyIds(tab.paneRoot);
    for (const ptyId of ptyIds) {
      disposeCached(ptyId);
      try {
        await closePty(ptyId);
      } catch {
        /* PTY may be dead */
      }
    }
    closeTab(tab.id);
  }, []);

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
      <div
        ref={scrollRef}
        className="scrollbar-none flex h-full min-w-0 flex-1 items-stretch overflow-x-auto"
        style={{ maskImage, WebkitMaskImage: maskImage }}
      >
        {tabs.map((tab) => (
          <TabItemComponent
            key={tab.id}
            tab={tab}
            isActive={tab.id === activeTabId}
            onSwitch={() => switchTab(tab.id)}
            onClose={() => handleClose(tab)}
          />
        ))}
      </div>
      <button
        onClick={addTab}
        title="New Tab"
        className="mx-1 flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center text-lg leading-none text-text-muted hover:text-text-primary"
      >
        +
      </button>
    </div>
  );
}
