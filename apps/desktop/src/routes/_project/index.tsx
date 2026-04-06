import type { ComponentType } from 'react';

import { createFileRoute } from '@tanstack/react-router';
import { Bot, FolderPlus, GitBranch, PanelLeft, Terminal } from 'lucide-react';

import { Button, Kbd } from '../../components/ui';
import { useProjects } from '../../hooks/useCollections';
import { openAddProjectDialog, toggleSidebar } from '../../lib/project-actions';

const FEATURES: { Icon: ComponentType<{ size: number }>; label: string }[] = [
  { Icon: Terminal, label: 'Native terminals' },
  { Icon: GitBranch, label: 'Git-native workflow' },
  { Icon: Bot, label: 'Agent monitoring' },
];

function Onboarding() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-10 select-none">
      <div className="flex flex-col items-center gap-4">
        <img src="/logo.png" alt="Superagent" className="h-14 w-14" />
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="font-mono text-lg font-semibold tracking-tight text-text-primary">
            Welcome to Superagent
          </h1>
          <p className="max-w-[260px] font-mono text-sm leading-relaxed text-text-muted">
            Run and monitor AI coding agents across all your git projects.
          </p>
        </div>
      </div>

      <div className="flex flex-col items-center gap-3">
        <Button variant="primary" size="md" onPress={() => openAddProjectDialog()}>
          <FolderPlus size={14} />
          Add a project
        </Button>
        <span className="font-mono text-xs text-text-faint">
          or press <Kbd>⌘N</Kbd>
        </span>
      </div>

      <div className="flex items-center gap-6">
        {FEATURES.map(({ Icon, label }) => (
          <div key={label} className="flex items-center gap-1.5 font-mono text-xs text-text-faint">
            <Icon size={13} />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function IndexRoute() {
  const projects = useProjects();

  if (projects.length === 0) return <Onboarding />;

  return (
    <div className="flex flex-1 flex-col items-center justify-center select-none">
      <Button variant="ghost" onPress={toggleSidebar}>
        <PanelLeft size={14} />
        Toggle sidebar
        <Kbd>⌘B</Kbd>
      </Button>
    </div>
  );
}

export const Route = createFileRoute('/_project/')({ component: IndexRoute });
