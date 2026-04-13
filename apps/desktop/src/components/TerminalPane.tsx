import { useRef, useState, useEffect, useMemo, useCallback } from 'react';

import {
  getSettingCollection,
  getSetting,
  setSetting,
  getSessionCollection,
  getTabCollection,
} from '@canopy/db';
import { useTerminal, getPtyCwd } from '@canopy/terminal';
import { CircleX } from 'lucide-react';

import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { setFocus, setPtyId, renameTab } from '../lib/tab-actions';
import { ClaudeCodeIcon } from './ClaudeCodeIcon';
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
  const [savedCwd, savedInitCmd] = useMemo(() => {
    const s = getSettingCollection().toArray;
    return [
      (getSetting(s, `cwd:${paneId}`, '') as string) || undefined,
      (getSetting(s, `init-cmd:${paneId}`, '') as string) || undefined,
    ];
  }, [paneId]);

  // Poll CWD from Rust side and persist changes.
  // Focused pane: 2s (immediate feedback for cd, etc.).
  // Unfocused panes: 10s (stale for a moment is fine; 5× fewer socket round-trips).
  const refreshCwdRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (realPtyId === null) return;

    let cancelled = false;
    const intervalMs = isFocused ? 2_000 : 10_000;

    const poll = async () => {
      try {
        const newCwd = await getPtyCwd(paneId);
        if (!cancelled && newCwd) {
          setCwd((prev) => {
            if (prev === newCwd) return prev;
            setSetting(`cwd:${paneId}`, newCwd);
            return newCwd;
          });
        }
      } catch (e) {
        console.error('[cwd] getPtyCwd failed:', e);
      }
    };

    refreshCwdRef.current = () => {
      void poll();
    };

    void poll();
    const interval = setInterval(poll, intervalMs);

    return () => {
      cancelled = true;
      refreshCwdRef.current = null;
      clearInterval(interval);
    };
  }, [realPtyId, paneId, isFocused]);

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
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-base select-none">
        <CircleX size={20} className="text-fg-faint opacity-60" aria-hidden="true" />
        <span className="font-mono text-sm text-fg-faint">Session terminated</span>
      </div>
    );
  }

  return (
    <TerminalPaneInner
      paneId={paneId}
      ptyId={realPtyId ?? ptyId}
      savedCwd={savedCwd}
      savedInitCmd={savedInitCmd}
      isFocused={isFocused}
      cwd={cwd}
      containerRef={containerRef}
      refreshCwdRef={refreshCwdRef}
      onPtySpawned={(id) => {
        setRealPtyId(id);
        setPtyId(paneId, id);
        const col = getSessionCollection();
        const tab = getTabCollection().toArray.find((t) => containsPane(t.paneRoot, paneId));
        const existing = col.toArray.find((s) => s.paneId === paneId);
        if (existing) {
          col.update(existing.id, (draft) => {
            draft.tabId = tab?.id ?? '';
            draft.projectId = tab?.projectItemId ?? null;
            draft.cwd = savedCwd ?? '';
          });
        } else {
          col.insert({
            id: paneId,
            paneId,
            tabId: tab?.id ?? '',
            projectId: tab?.projectItemId ?? null,
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
  savedInitCmd,
  isFocused,
  cwd,
  containerRef,
  refreshCwdRef,
  onPtySpawned,
}: {
  paneId: string;
  ptyId: number;
  savedCwd: string | undefined;
  savedInitCmd: string | undefined;
  isFocused: boolean;
  cwd: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  refreshCwdRef: React.RefObject<(() => void) | null>;
  onPtySpawned: (id: number) => void;
}) {
  const handleCommand = useCallback(
    (cmd: string) => {
      if (!isFocused) return;
      const tab = getTabCollection().toArray.find((t) => containsPane(t.paneRoot, paneId));
      if (tab && !tab.labelIsManual) {
        const label = cmd.length > 10 ? `${cmd.slice(0, 10)}...` : cmd;
        renameTab(tab.id, label, false);
      }
      // Refresh CWD immediately after each command (e.g. cd)
      setTimeout(() => refreshCwdRef.current?.(), 150);
    },
    [paneId, isFocused, refreshCwdRef],
  );

  const termRef = useTerminal(
    containerRef,
    paneId,
    savedCwd,
    ptyId,
    isFocused,
    onPtySpawned,
    handleCommand,
    savedInitCmd,
  );

  const agents = useAgents();
  const agent = agents.find((a) => a.ptyId === ptyId);
  const agentStatus = agent?.status ?? 'idle';
  // Hide the raw terminal output while Claude boots — avoids showing TUI escape
  // sequences and flickering startup. Only applies to Claude auto-launch sessions
  // (those with an init-cmd containing "claude"). Removed once the agent watcher
  // detects the Claude process (agentStatus leaves 'idle'), or after 15s fallback.
  // Skip on re-mount (tab switch) when the agent is already running — agentStatus
  // is read from the live collection at mount time, so this is synchronous.
  const [bootOverlay, setBootOverlay] = useState(
    () => agentStatus === 'idle' && !!savedInitCmd?.includes('claude'),
  );

  // One-time 15s fallback — scheduled once on mount, never restarted.
  // Separate from the agent-detection effect to avoid timer stacking on each
  // agentStatus change while still idle.
  useEffect(() => {
    if (!bootOverlay) return;
    const t = setTimeout(() => setBootOverlay(false), 15_000);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Dismiss sooner once the agent is detected (or immediately if already detected).
  // Reveal as soon as the agent is detected (any non-idle status). This also
  // handles edge cases where Claude shows an interactive prompt (e.g., trust dialog)
  // before processing the initial prompt: the overlay must clear so the user can respond.
  useEffect(() => {
    if (!bootOverlay) return;
    if (agentStatus === 'idle') return;
    const t = setTimeout(() => setBootOverlay(false), 350);
    return () => clearTimeout(t);
  }, [agentStatus, bootOverlay]);

  // Sync the claude-code icon with the agent watcher: set when claude is running, clear on exit.
  useEffect(() => {
    if (ptyId <= 0) return;
    const tab = getTabCollection().toArray.find((t) => containsPane(t.paneRoot, paneId));
    if (!tab) return;
    const claudeActive = agent?.agentName === 'claude' && agentStatus !== 'idle';
    if (claudeActive && tab.icon !== 'claude-code') {
      getTabCollection().update(tab.id, (draft) => {
        draft.icon = 'claude-code';
      });
    } else if (!claudeActive && tab.icon === 'claude-code') {
      getTabCollection().update(tab.id, (draft) => {
        draft.icon = undefined;
      });
    }
  }, [agent?.agentName, agentStatus, ptyId, paneId]);

  return (
    <div
      className="relative h-full w-full"
      data-testid="terminal-pane-wrapper"
      style={{ border: '1px solid transparent' }}
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
      {bootOverlay && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-base select-none">
          <ClaudeCodeIcon size={20} className="animate-pulse text-claude/60" />
          <span className="font-mono text-sm text-fg-faint">Starting Claude Code…</span>
        </div>
      )}
    </div>
  );
}
