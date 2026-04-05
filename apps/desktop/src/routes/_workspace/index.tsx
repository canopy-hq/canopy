import { createFileRoute } from '@tanstack/react-router';

import { Kbd } from '../../components/ui';
import { toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 select-none">
      <span className="font-mono text-sm text-text-faint">No workspace selected</span>
      <button
        type="button"
        onClick={() => toggleSidebar()}
        className="flex items-center gap-1.5 font-mono text-sm text-text-faint transition-colors hover:text-text-muted"
      >
        Open sidebar <Kbd>⌘B</Kbd>
      </button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({ component: IndexRoute });
