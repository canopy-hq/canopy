import { createFileRoute } from '@tanstack/react-router';
import { FolderPlus, PanelLeft } from 'lucide-react';

import { Kbd } from '../../components/ui';
import { openImportDialog, toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 select-none">
      <button
        type="button"
        onClick={() => void openImportDialog()}
        className="flex w-72 items-center gap-3 rounded-md px-4 py-3 text-text-faint transition-colors hover:bg-white/[0.04] hover:text-text-muted"
      >
        <FolderPlus size={15} className="shrink-0" />
        <span className="flex-1 text-left font-mono text-base">Add Project</span>
        <Kbd>⌘N</Kbd>
      </button>
      <button
        type="button"
        onClick={() => toggleSidebar()}
        className="flex w-72 items-center gap-3 rounded-md px-4 py-3 text-text-faint transition-colors hover:bg-white/[0.04] hover:text-text-muted"
      >
        <PanelLeft size={15} className="shrink-0" />
        <span className="flex-1 text-left font-mono text-base">Toggle Sidebar</span>
        <Kbd>⌘B</Kbd>
      </button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({ component: IndexRoute });
