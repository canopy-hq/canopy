import { useCallback, useEffect, useRef } from 'react';

import { Plus } from 'lucide-react';

import { useUiState, useWorkspaces } from '../hooks/useCollections';
import { importRepo, setSidebarWidth } from '../lib/workspace-actions';
import { Button } from './ui';
import { WorkspaceTree } from './WorkspaceTree';

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
      <span className="text-[13px] font-semibold text-text-primary">No workspaces</span>
      <span className="text-center text-[11px] text-text-muted">
        Import a git repository to get started.
      </span>
      <Button
        variant="ghost"
        onPress={onImport}
        className="mt-2 w-full rounded-md border border-dashed border-border py-1.5 text-[12px]"
      >
        <Plus size={12} strokeWidth={1.5} />
        Import Repository
      </Button>
    </div>
  );
}

export function Sidebar() {
  const ui = useUiState();
  const visible = ui.sidebarVisible;
  const width = ui.sidebarWidth;
  const workspaces = useWorkspaces();

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleImport = useCallback(async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Git Repository',
      });
      if (selected && typeof selected === 'string') {
        await importRepo(selected);
      }
    } catch {
      // Dialog not available in test/dev environments
    }
  }, []);

  // Clean up forced cursor if component unmounts mid-drag
  useEffect(() => {
    return () => {
      if (dragRef.current) document.body.style.cursor = '';
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      dragRef.current = { startX, startWidth };
      document.body.style.cursor = 'col-resize';

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const newWidth = dragRef.current.startWidth + (ev.clientX - dragRef.current.startX);
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [width],
  );

  if (!visible) return null;

  return (
    <div className="flex shrink-0 flex-row bg-bg-secondary" style={{ width: `${width}px` }}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto py-2">
          {workspaces.length === 0 ? <EmptyState onImport={handleImport} /> : <WorkspaceTree />}
        </div>
        <div className="shrink-0 border-t border-border p-2">
          <Button variant="secondary" onPress={handleImport} className="w-full">
            <Plus size={12} strokeWidth={1.5} />
            Add project
          </Button>
        </div>
      </div>
      <div
        className="relative w-px shrink-0 cursor-col-resize bg-border transition-colors after:absolute after:inset-y-0 after:-left-1 after:w-3 after:cursor-col-resize after:content-[''] hover:bg-accent"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
