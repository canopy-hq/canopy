import { useEffect, useMemo, useState } from 'react';

import { listPtySessions } from '@superagent/terminal';
import { useNavigate } from '@tanstack/react-router';

import { useAgents, useSettings, useTabs, useUiState, useProjects } from '../hooks/useCollections';
import { useDetectedEditors } from '../lib/editor';
import { buildAgentCommands } from './agent-commands';
import { buildEditorCommands } from './editor-commands';
import { buildProjectCommands } from './project-commands';
import { buildPtyCommands } from './pty-commands';
import { buildStaticCommands } from './static-commands';
import { buildTabCommands } from './tab-commands';

import type { CommandItem } from '@superagent/command-palette';
import type { PtySessionInfo } from '@superagent/terminal';

export function useAllCommands(): CommandItem[] {
  const navigate = useNavigate();
  const projects = useProjects();
  const tabs = useTabs();
  const agents = useAgents();
  const uiState = useUiState();
  const settings = useSettings();
  const editors = useDetectedEditors();
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
      ...buildProjectCommands(
        projects,
        settings,
        navigate,
        uiState.activeContextId,
        uiState.cloningProjectIds,
      ),
      ...buildTabCommands(tabs, uiState, navigate, projects),
      ...buildAgentCommands(agents, tabs, projects, navigate),
      ...buildPtyCommands(ptySessions, tabs, projects, navigate),
      ...buildEditorCommands(editors, settings, uiState.activeContextId),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projects, tabs, agents, uiState, settings, ptySessions, editors],
  );
}
