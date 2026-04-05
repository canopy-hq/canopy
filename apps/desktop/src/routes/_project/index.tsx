import { createFileRoute } from '@tanstack/react-router';
import { FolderPlus, PanelLeft } from 'lucide-react';

import { ActionRow } from '../../components/ui';
import { useProjects } from '../../hooks/useCollections';
import { openImportDialog, toggleSidebar } from '../../lib/project-actions';

function IndexRoute() {
  const projects = useProjects();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 select-none">
      <ActionRow
        icon={<FolderPlus size={15} />}
        label="Add Project"
        shortcut="⌘N"
        onPress={() => void openImportDialog()}
      />
      {projects.length > 0 && (
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

export const Route = createFileRoute('/_project/')({ component: IndexRoute });
