import { createFileRoute } from '@tanstack/react-router';

import { toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
      <span className="text-lg font-semibold text-text-primary">No workspace selected</span>
      <span className="max-w-[280px] text-center text-sm">
        Import a git repository and select a branch or worktree to start working.
      </span>
      <button
        className="mt-2 h-8 cursor-pointer rounded bg-bg-tertiary px-4 text-[13px] text-text-muted hover:text-accent"
        onClick={() => toggleSidebar()}
      >
        Open Sidebar (⌘B)
      </button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({ component: IndexRoute });
