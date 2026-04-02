import { useCallback, useRef } from 'react';
import { useUiState, useWorkspaces } from '../hooks/useCollections';
import { importRepo, setSidebarWidth } from '../lib/workspace-actions';
import { WorkspaceTree } from './WorkspaceTree';

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-2 px-4">
      <span
        className="text-text-primary font-semibold"
        style={{ fontSize: '13px' }}
      >
        No workspaces
      </span>
      <span
        className="text-text-muted text-center"
        style={{ fontSize: '11px' }}
      >
        Import a git repository to get started.
      </span>
      <button
        className="mt-2 w-full h-8 bg-bg-tertiary text-text-muted hover:text-[var(--accent)] cursor-pointer"
        style={{ fontSize: '13px', borderRadius: '4px' }}
        onClick={onImport}
      >
        Import Repository
      </button>
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

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;
      dragRef.current = { startX, startWidth };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const newWidth = dragRef.current.startWidth + (ev.clientX - dragRef.current.startX);
        setSidebarWidth(newWidth);
      };

      const handleMouseUp = () => {
        dragRef.current = null;
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
    <div
      className="flex-shrink-0 border-r border-border bg-bg-secondary flex flex-row"
      style={{ width: `${width}px` }}
    >
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex-1 overflow-y-auto py-2">
          {workspaces.length === 0 ? (
            <EmptyState onImport={handleImport} />
          ) : (
            <WorkspaceTree />
          )}
        </div>
        <div className="flex-shrink-0 border-t border-border p-2">
          <button
            className="w-full h-8 bg-bg-tertiary text-text-muted hover:text-[var(--accent)] cursor-pointer"
            style={{ fontSize: '13px', borderRadius: '4px' }}
            onClick={handleImport}
          >
            Import Repository
          </button>
        </div>
      </div>
      <div
        className="w-1 cursor-col-resize hover:bg-[var(--accent)] hover:opacity-50 flex-shrink-0"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
