import { useRef, useState, useEffect, useMemo } from 'react';

import { getSettingCollection, getSetting, setSetting, getSessionCollection, getTabCollection } from '@superagent/db';
import { useTerminal, getPtyCwd } from '@superagent/terminal';

import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { setFocus, setPtyId } from '../lib/tab-actions';

import { PaneHeader } from './PaneHeader';

import type { PaneNode } from '../lib/pane-tree-ops';

function containsPane(node: PaneNode, paneId: string): boolean {
  if (node.type === 'leaf') return node.id === paneId;
  return node.children.some((c) => containsPane(c, paneId));
}

interface TerminalPaneProps {
  paneId: string;
  ptyId: number;
}

/**
 * Single terminal pane with floating CWD header and focus indicator.
 *
 * Delegates PTY spawn to useTerminal so that spawn dimensions are derived from
 * the fitted terminal — eliminating dimension estimates and spurious SIGWINCHes.
 */
export function TerminalPane({ paneId, ptyId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const killedRef = useRef(false);
  const tabs = useTabs();
  const ui = useUiState();
  const activeTab = tabs.find((t) => t.id === ui.activeTabId);
  const focusedPaneId = activeTab?.focusedPaneId ?? null;
  const isFocused = focusedPaneId === paneId;
  const [cwd, setCwd] = useState('');
  const [realPtyId, setRealPtyId] = useState<number | null>(ptyId > 0 ? ptyId : null);

  // Read once; only used for the initial spawn inside useTerminal.
  const savedCwd = useMemo(() => {
    const v = getSetting(getSettingCollection().toArray, `cwd:${paneId}`, '') as string;
    return v || undefined;
  }, [paneId]);

  // Poll CWD from Rust side every 2 seconds and persist changes.
  useEffect(() => {
    if (realPtyId === null) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const newCwd = await getPtyCwd(realPtyId);
        if (!cancelled && newCwd) {
          setCwd((prev) => {
            if (prev === newCwd) return prev;
            setSetting(`cwd:${paneId}`, newCwd);
            return newCwd;
          });
        }
      } catch {
        // PTY may be dead
      }
    };

    void poll();
    const interval = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [realPtyId, paneId]);

  // Delete session record when killed (ptyId → -2) or when pane is removed from tree.
  useEffect(() => {
    if (ptyId !== -2) return;
    killedRef.current = true;
    const col = getSessionCollection();
    const session = col.toArray.find((s) => s.paneId === paneId);
    if (session) col.delete(session.id);
  }, [ptyId, paneId]);

  useEffect(() => {
    return () => {
      if (killedRef.current) return;
      const col = getSessionCollection();
      const session = col.toArray.find((s) => s.paneId === paneId);
      if (session) col.delete(session.id);
    };
  }, [paneId]);

  if (ptyId === -2) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-bg-primary">
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-text-muted opacity-40"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <line x1="9" y1="9" x2="15" y2="15" />
          <line x1="15" y1="9" x2="9" y2="15" />
        </svg>
        <div className="flex flex-col items-center gap-1 text-center">
          <span className="text-sm font-semibold text-text-muted">Session terminated</span>
          <span className="max-w-[260px] text-[12px] leading-relaxed text-text-muted opacity-60">
            This PTY session was forcefully killed. Open a new tab to start a fresh terminal.
          </span>
        </div>
      </div>
    );
  }

  return (
    <TerminalPaneInner
      paneId={paneId}
      ptyId={realPtyId ?? ptyId}
      savedCwd={savedCwd}
      isFocused={isFocused}
      cwd={cwd}
      containerRef={containerRef}
      onPtySpawned={(id) => {
        setRealPtyId(id);
        setPtyId(paneId, id);
        const col = getSessionCollection();
        const tab = getTabCollection().toArray.find((t) => containsPane(t.paneRoot, paneId));
        const existing = col.toArray.find((s) => s.paneId === paneId);
        if (existing) {
          col.update(existing.id, (draft) => {
            draft.tabId = tab?.id ?? '';
            draft.workspaceId = tab?.workspaceItemId ?? null;
            draft.cwd = savedCwd ?? '';
          });
        } else {
          col.insert({
            id: paneId,
            paneId,
            tabId: tab?.id ?? '',
            workspaceId: tab?.workspaceItemId ?? null,
            cwd: savedCwd ?? '',
            shell: '',
          });
        }
      }}
    />
  );
}

/**
 * Inner component — separated so hook calls stay unconditional.
 */
function TerminalPaneInner({
  paneId,
  ptyId,
  savedCwd,
  isFocused,
  cwd,
  containerRef,
  onPtySpawned,
}: {
  paneId: string;
  ptyId: number;
  savedCwd: string | undefined;
  isFocused: boolean;
  cwd: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onPtySpawned: (id: number) => void;
}) {
  const termRef = useTerminal(containerRef, paneId, savedCwd, ptyId, isFocused, onPtySpawned);

  const agents = useAgents();
  const agent = agents.find((a) => a.ptyId === ptyId);
  const agentStatus = agent?.status ?? 'idle';
  const isWaiting = agentStatus === 'waiting';

  return (
    <div
      className="relative h-full w-full"
      data-testid="terminal-pane-wrapper"
      style={{
        border: isWaiting
          ? '1px solid var(--agent-waiting-border)'
          : '1px solid transparent',
        boxShadow: isWaiting
          ? '0 0 12px var(--agent-waiting-glow), inset 0 0 24px var(--agent-waiting-inset)'
          : 'none',
        transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      }}
      onPointerDown={() => {
        setFocus(paneId);
        termRef.current?.focus();
      }}
    >
      <PaneHeader
        cwd={cwd}
        isFocused={isFocused}
        agentStatus={agentStatus}
        agentName={agent?.agentName}
      />
      <div ref={containerRef} className="h-full w-full overflow-hidden" />
    </div>
  );
}
