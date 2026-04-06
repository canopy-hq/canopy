import { toggleManualOverride } from '../lib/agent-actions';
import { containsPtyId } from '../lib/pane-tree-ops';
import { jumpToPane } from '../lib/tab-actions';
import { resolveProjectForTab } from './utils';

import type { Nav, CommandItem } from '@superagent/command-palette';
import type { AgentInfo, Tab, Project } from '@superagent/db';

export function buildAgentCommands(
  agents: AgentInfo[],
  tabs: Tab[],
  projects: Project[],
  navigate: Nav,
): CommandItem[] {
  return agents.map((agent): CommandItem => {
    const tab = tabs.find((t) => containsPtyId(t.paneRoot, agent.ptyId));
    const proj = tab ? resolveProjectForTab(tab, projects) : undefined;
    const label = proj ? `${agent.agentName} — ${proj.name}` : agent.agentName;

    return {
      id: `agent:${agent.ptyId}`,
      label,
      category: 'agent',
      keywords: [agent.agentName, proj?.name ?? '', 'ai', 'claude'],
      icon: 'agent',
      agentStatus: agent.status,
      action: ({ close }) => {
        if (tab) jumpToPane(navigate, tab.projectItemId, tab.id);
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
        jumpToPane(navigate, tab.projectItemId, tab.id);
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
