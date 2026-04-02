import { useRef, useState, useEffect } from 'react';
import { useTerminal } from '../hooks/useTerminal';
import { useTabsStore } from '../stores/tabs-store';
import { useAgentStore, selectAgentForPty } from '../stores/agent-store';
import { spawnTerminal, getPtyCwd } from '../lib/pty';
import { PaneHeader } from './PaneHeader';

interface TerminalPaneProps {
  paneId: string;
  ptyId: number;
}

/**
 * Single terminal pane with floating CWD header and focus indicator.
 *
 * Handles the ptyId=-1 sentinel case by spawning a new PTY on mount,
 * then updating the pane tree store via setPtyId.
 */
export function TerminalPane({ paneId, ptyId }: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const focusedPaneId = useTabsStore((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTabId);
    return tab?.focusedPaneId ?? null;
  });
  const setFocus = useTabsStore((s) => s.setFocus);
  const setPtyId = useTabsStore((s) => s.setPtyId);
  const isFocused = focusedPaneId === paneId;
  const [cwd, setCwd] = useState('');
  const [realPtyId, setRealPtyId] = useState<number | null>(ptyId > 0 ? ptyId : null);

  // Sentinel PTY spawn: if ptyId is -1, spawn a new PTY on mount
  useEffect(() => {
    if (ptyId > 0) return;
    if (realPtyId !== null) return;

    let cancelled = false;

    spawnTerminal().then((id) => {
      if (cancelled) return;
      setRealPtyId(id);
      setPtyId(paneId, id);
    });

    return () => {
      cancelled = true;
    };
  }, [ptyId, realPtyId, paneId, setPtyId]);

  // Poll CWD from Rust side every 2 seconds
  useEffect(() => {
    if (realPtyId === null) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const newCwd = await getPtyCwd(realPtyId);
        if (!cancelled && newCwd) setCwd(newCwd);
      } catch {
        // PTY may be dead or command not available
      }
    };

    poll();
    const interval = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [realPtyId]);

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
      setFocus={setFocus}
      containerRef={containerRef}
    />
  );
}

/**
 * Inner component that renders once we have a valid PTY ID.
 * Separated to keep the hook call unconditional (hooks can't be after early return).
 */
function TerminalPaneInner({
  paneId,
  ptyId,
  isFocused,
  cwd,
  setFocus,
  containerRef,
}: {
  paneId: string;
  ptyId: number;
  isFocused: boolean;
  cwd: string;
  setFocus: (paneId: string) => void;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const termRef = useTerminal(containerRef, ptyId, isFocused);

  const agent = useAgentStore(selectAgentForPty(ptyId));
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
