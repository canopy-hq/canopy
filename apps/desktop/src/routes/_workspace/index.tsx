import { createFileRoute } from '@tanstack/react-router';

import { Button } from '../../components/ui';
import { toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
      <span className="text-lg font-semibold text-text-primary">No workspace selected</span>
      <span className="max-w-[280px] text-center text-sm">
        Import a git repository and select a branch or worktree to start working.
      </span>
      <Button variant="secondary" className="mt-2" onPress={() => toggleSidebar()}>
        Open Sidebar (⌘B)
      </Button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({ component: IndexRoute });
