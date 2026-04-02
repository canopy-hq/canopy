import { useRef, useState, useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { setFocus, setPtyId } from '../lib/tab-actions';
import { spawnTerminal, getPtyCwd } from '../lib/pty';
import { getSettingCollection, getSetting, setSetting } from '@superagent/db';
import { PaneHeader } from './PaneHeader';

interface TerminalPaneProps {
  paneId: string;
  ptyId: number;
}

/**
 * Single terminal pane with floating CWD header and focus indicator.
 *
 * Handles the ptyId=-1 sentinel case by spawning (or reconnecting to) a daemon
 * session keyed by paneId. On cold restart the daemon replays scrollback.
 */
export function TerminalPane({ paneId, ptyId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tabs = useTabs();
  const ui = useUiState();
  const activeTab = tabs.find((t) => t.id === ui.activeTabId);
  const focusedPaneId = activeTab?.focusedPaneId ?? null;
  const isFocused = focusedPaneId === paneId;
  const [cwd, setCwd] = useState('');
  const [realPtyId, setRealPtyId] = useState<number | null>(ptyId > 0 ? ptyId : null);

  // Sentinel PTY spawn: if ptyId is -1, spawn / reconnect on mount
  useEffect(() => {
    if (ptyId > 0) return;
    if (realPtyId !== null) return;

    let cancelled = false;

    const settings = getSettingCollection().toArray;
    const savedCwd = getSetting(settings, `cwd:${paneId}`, '') as string;

    spawnTerminal(paneId, savedCwd || undefined).then((id) => {
      if (cancelled) return;
      setRealPtyId(id);
      setPtyId(paneId, id);
    });

    return () => {
      cancelled = true;
    };
  }, [ptyId, realPtyId, paneId]);

  // Poll CWD from Rust side every 2 seconds and persist changes
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

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [realPtyId, paneId]);

  if (realPtyId === null) {
    return (
      <div className="h-full w-full flex items-center justify-center text-gray-500 text-sm">
        Starting terminal...
      </div>
    );
  }

  return (
    <TerminalPaneInner
      paneId={paneId}
      ptyId={realPtyId}
      isFocused={isFocused}
      cwd={cwd}
      containerRef={containerRef}
    />
  );
}

/**
 * Inner component that renders once we have a valid PTY ID.
 * Separated to keep hook calls unconditional (hooks can't be after early return).
 */
function TerminalPaneInner({
  paneId,
  ptyId,
  isFocused,
  cwd,
  containerRef,
}: {
  paneId: string;
  ptyId: number;
  isFocused: boolean;
  cwd: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const termRef = useTerminal(containerRef, ptyId, isFocused);

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
          : isFocused
            ? '1px solid var(--border-focus)'
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
