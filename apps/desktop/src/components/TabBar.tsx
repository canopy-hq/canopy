import { useCallback, useEffect, useRef, useState } from 'react';

import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { addTab, closeTab, switchTab } from '../lib/tab-actions';
import { StatusDot } from './StatusDot';
import { collectLeafPtyIds } from '../lib/pane-tree-ops';
import type { Tab } from '@superagent/db';
import type { DotStatus } from './StatusDot';
import { closePty, disposeCached } from '@superagent/terminal';

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

function TabItem({
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

  return (
    <button
      className={`group relative flex h-full max-w-[240px] min-w-[120px] flex-shrink cursor-pointer items-center gap-1.5 rounded-t-md border-t-2 px-3 transition-colors ${
        isActive
          ? 'border-t-accent bg-tab-active-bg text-text-primary'
          : 'border-t-transparent bg-tab-inactive-bg text-text-muted hover:bg-bg-secondary'
      }`}
      style={{
        backgroundColor: agentStatus === 'waiting' ? 'var(--agent-waiting-glow)' : undefined,
      }}
      onClick={onSwitch}
      onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(); } }}
      title={tab.label}
    >
      {agentStatus !== 'idle' && <StatusDot status={agentStatus} size={8} />}
      <span className="flex-1 truncate text-left text-xs">{tab.label}</span>
      {agentStatus === 'waiting' && (
        <span
          style={{
            fontSize: '10px',
            fontWeight: 400,
            backgroundColor: 'rgba(251, 191, 36, 0.25)',
            color: 'var(--agent-waiting)',
            borderRadius: '9999px',
            padding: '4px 8px',
            lineHeight: 1,
          }}
        >
          input
        </span>
      )}
      <span
        role="button"
        tabIndex={-1}
        className={`flex h-4 w-4 items-center justify-center rounded-sm text-[10px] leading-none hover:bg-bg-tertiary ${
          isActive
            ? 'opacity-60 hover:opacity-100'
            : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'
        }`}
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
    </button>
  );
}

export function TabBar() {
  const allTabs = useTabs();
  const ui = useUiState();
  const activeContextId = ui.activeContextId;
  const tabs = allTabs.filter((t) => t.workspaceItemId === activeContextId);
  const activeTabId = ui.activeTabId;

  const handleClose = useCallback(async (tab: Tab) => {
    const ptyIds = collectLeafPtyIds(tab.paneRoot);
    for (const ptyId of ptyIds) {
      disposeCached(ptyId);
      try { await closePty(ptyId); } catch { /* PTY may be dead */ }
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
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    updateScrollState();
    return () => {
      el.removeEventListener('scroll', updateScrollState);
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
    <div className="flex h-9 flex-shrink-0 items-center border-b border-border bg-bg-primary">
      <div
        ref={scrollRef}
        className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto"
        style={{ scrollbarWidth: 'none', maskImage, WebkitMaskImage: maskImage }}
      >
        {tabs.map((tab) => (
          <TabItem
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
        className="mx-1 flex h-8 w-8 flex-shrink-0 cursor-pointer items-center justify-center text-lg leading-none text-text-muted hover:text-text-primary"
      >
        +
      </button>
    </div>
  );
}
