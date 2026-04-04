import { useCallback, useRef } from 'react';

import { getUiState } from '@superagent/db';

import { useUiState, useWorkspaces } from '../hooks/useCollections';
import { importRepo, setSidebarWidth, persistSidebarWidth } from '../lib/workspace-actions';
import { WorkspaceTree } from './WorkspaceTree';

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
      <span className="text-[13px] font-semibold text-text-primary">No workspaces</span>
      <span className="text-center text-[11px] text-text-muted">
        Import a git repository to get started.
      </span>
      <button
        className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-[12px] text-text-muted hover:text-accent"
        onClick={onImport}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M8 3v10M3 8h10" />
        </svg>
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
        if (dragRef.current) {
          persistSidebarWidth(getUiState().sidebarWidth);
        }
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
      className="flex shrink-0 flex-row border-r border-border bg-bg-secondary"
      style={{ width: `${width}px` }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto py-2">
          {workspaces.length === 0 ? <EmptyState onImport={handleImport} /> : <WorkspaceTree />}
        </div>
        <div className="shrink-0 border-t border-border p-2">
          <button
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-1.5 text-[12px] text-text-muted"
            onClick={handleImport}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M8 3v10M3 8h10" />
            </svg>
            Import
          </button>
        </div>
      </div>
      <div
        className="relative z-10 -ml-1 w-1 cursor-col-resize hover:bg-accent hover:opacity-50"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
