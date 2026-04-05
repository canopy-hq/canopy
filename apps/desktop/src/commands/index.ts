import { useEffect, useMemo, useState } from 'react';

import { listPtySessions } from '@superagent/terminal';
import { useNavigate } from '@tanstack/react-router';

import {
  useAgents,
  useSettings,
  useTabs,
  useUiState,
  useWorkspaces,
} from '../hooks/useCollections';
import { buildAgentCommands } from './agent-commands';
import { buildPtyCommands } from './pty-commands';
import { buildStaticCommands } from './static-commands';
import { buildTabCommands } from './tab-commands';
import { buildWorkspaceCommands } from './workspace-commands';

import type { CommandItem } from '@superagent/command-palette';
import type { PtySessionInfo } from '@superagent/terminal';

export function useAllCommands(): CommandItem[] {
  const navigate = useNavigate();
  const workspaces = useWorkspaces();
  const tabs = useTabs();
  const agents = useAgents();
  const uiState = useUiState();
  const settings = useSettings();
  const [ptySessions, setPtySessions] = useState<PtySessionInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (cancelled) return;
      if (document.visibilityState !== 'hidden') {
        try {
          const sessions = await listPtySessions();
          if (!cancelled) {
            // Only update state when sessions actually changed to avoid spurious re-renders
            setPtySessions((prev) => {
              if (
                prev.length === sessions.length &&
                prev.every(
                  (s, i) =>
                    s.ptyId === sessions[i]!.ptyId &&
                    s.cpuPercent === sessions[i]!.cpuPercent &&
                    s.memoryMb === sessions[i]!.memoryMb,
                )
              ) {
                return prev;
              }
              return sessions;
            });
          }
        } catch {
          // PTY daemon may not be running yet
        }
      }
      if (!cancelled) setTimeout(poll, 3000);
    }

    void poll();
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(
    () => [
      ...buildStaticCommands(navigate),
      ...buildWorkspaceCommands(workspaces, settings, navigate, uiState.activeContextId),
      ...buildTabCommands(tabs, uiState, navigate, workspaces),
      ...buildAgentCommands(agents, tabs, workspaces, navigate),
      ...buildPtyCommands(ptySessions, tabs, workspaces, navigate),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, tabs, agents, uiState, settings, ptySessions],
  );
}
