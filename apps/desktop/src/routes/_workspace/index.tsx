import { createFileRoute } from '@tanstack/react-router';
import { toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
      <span className="text-lg font-semibold text-text-primary">No workspace selected</span>
      <span className="text-sm text-center max-w-[280px]">
        Import a git repository and select a branch or worktree to start working.
      </span>
      <button
        className="mt-2 px-4 h-8 bg-bg-tertiary text-text-muted hover:text-[var(--accent)] cursor-pointer"
        style={{ fontSize: '13px', borderRadius: '4px' }}
        onClick={() => toggleSidebar()}
      >
        Open Sidebar (⌘B)
      </button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({
  component: IndexRoute,
});
