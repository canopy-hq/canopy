import { createFileRoute } from '@tanstack/react-router';

import { Button, Kbd } from '../../components/ui';
import { toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
      <span className="text-xl font-semibold text-text-primary">No workspace selected</span>
      <span className="max-w-[280px] text-center text-lg">
        Import a git repository and select a branch or worktree to start working.
      </span>
      <Button variant="secondary" className="mt-2 gap-2" onPress={() => toggleSidebar()}>
        Open Sidebar <Kbd>⌘B</Kbd>
      </Button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({ component: IndexRoute });
