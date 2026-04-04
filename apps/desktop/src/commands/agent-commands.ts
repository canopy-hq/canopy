import { toggleManualOverride } from '../lib/agent-actions';
import { containsPtyId } from '../lib/pane-tree-ops';
import { jumpToPane } from '../lib/tab-actions';
import { resolveWorkspaceForTab } from './utils';

import type { Nav, CommandItem } from '@superagent/command-palette';
import type { AgentInfo, Tab, Workspace } from '@superagent/db';

export function buildAgentCommands(
  agents: AgentInfo[],
  tabs: Tab[],
  workspaces: Workspace[],
  navigate: Nav,
): CommandItem[] {
  return agents.map((agent): CommandItem => {
    const tab = tabs.find((t) => containsPtyId(t.paneRoot, agent.ptyId));
    const ws = tab ? resolveWorkspaceForTab(tab, workspaces) : undefined;
    const label = ws ? `${agent.agentName} — ${ws.name}` : agent.agentName;

    return {
      id: `agent:${agent.ptyId}`,
      label,
      category: 'agent',
      keywords: [agent.agentName, ws?.name ?? '', 'ai', 'claude'],
      icon: 'agent',
      agentStatus: agent.status,
      action: ({ close }) => {
        if (tab) jumpToPane(navigate, tab.workspaceItemId, tab.id);
        close();
      },
      children: () => buildAgentChildren(agent, tab, navigate),
    };
  });
}

function buildAgentChildren(agent: AgentInfo, tab: Tab | undefined, navigate: Nav): CommandItem[] {
  const items: CommandItem[] = [];

  if (tab) {
    items.push({
      id: `agent-action:jump:${agent.ptyId}`,
      label: 'Jump to terminal',
      category: 'agent',
      icon: 'tab',
      action: ({ close }) => {
        jumpToPane(navigate, tab.workspaceItemId, tab.id);
        close();
      },
    });
  }

  items.push({
    id: `agent-action:override:${agent.ptyId}`,
    label: agent.manualOverride ? 'Resume agent detection' : 'Disable agent detection',
    category: 'agent',
    icon: 'agent',
    action: ({ close }) => {
      toggleManualOverride(agent.ptyId);
      close();
    },
  });

  return items;
}
