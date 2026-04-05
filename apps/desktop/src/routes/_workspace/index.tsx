import { createFileRoute } from '@tanstack/react-router';
import { FolderPlus } from 'lucide-react';

import { Kbd } from '../../components/ui';
import { openImportDialog, toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 select-none">
      <div className="flex flex-col items-center gap-2">
        <span className="font-mono text-sm text-text-muted">No project selected</span>
        <span className="font-mono text-xs text-text-faint">
          Select a project from the sidebar or add a new one
        </span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() => void openImportDialog()}
          className="flex items-center gap-2 rounded-md border border-border/40 bg-bg-secondary px-4 py-2 font-mono text-sm text-text-muted transition-colors hover:border-border/60 hover:text-text-primary"
        >
          <FolderPlus size={14} />
          Add project
        </button>
        <button
          type="button"
          onClick={() => toggleSidebar()}
          className="flex items-center gap-1.5 font-mono text-xs text-text-faint transition-colors hover:text-text-muted"
        >
          Toggle sidebar <Kbd>⌘B</Kbd>
        </button>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({ component: IndexRoute });
