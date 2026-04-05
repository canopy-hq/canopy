import { createFileRoute } from '@tanstack/react-router';
import { FolderPlus, PanelLeft } from 'lucide-react';

import { ActionRow } from '../../components/ui';
import { useWorkspaces } from '../../hooks/useCollections';
import { openImportDialog, toggleSidebar } from '../../lib/workspace-actions';

function IndexRoute() {
  const workspaces = useWorkspaces();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 select-none">
      <ActionRow
        icon={<FolderPlus size={15} />}
        label="Add Project"
        shortcut="⌘N"
        onPress={() => void openImportDialog()}
      />
      {workspaces.length > 0 && (
        <ActionRow
          icon={<PanelLeft size={15} />}
          label="Toggle Sidebar"
          shortcut="⌘B"
          onPress={() => toggleSidebar()}
        />
      )}
    </div>
  );
}

export const Route = createFileRoute('/_workspace/')({ component: IndexRoute });
