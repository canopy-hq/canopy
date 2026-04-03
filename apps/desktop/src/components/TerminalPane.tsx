import { useRef, useState, useEffect, useMemo } from 'react';
import { useTerminal, getPtyCwd } from '@superagent/terminal';
import { useTabs, useAgents, useUiState } from '../hooks/useCollections';
import { setFocus, setPtyId } from '../lib/tab-actions';
import { getSettingCollection, getSetting, setSetting } from '@superagent/db';
import { PaneHeader } from './PaneHeader';

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
