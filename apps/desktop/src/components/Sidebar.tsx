import { useCallback, useRef } from "react";

import { useUiState, useWorkspaces } from "../hooks/useCollections";
import { importRepo, setSidebarWidth } from "../lib/workspace-actions";
import { WorkspaceTree } from "./WorkspaceTree";

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
      <span className="font-semibold text-text-primary" style={{ fontSize: "13px" }}>
        No workspaces
      </span>
      <span className="text-center text-text-muted" style={{ fontSize: "11px" }}>
        Import a git repository to get started.
      </span>
      <button
        className="mt-2 h-8 w-full cursor-pointer bg-bg-tertiary text-text-muted hover:text-[var(--accent)]"
        style={{ fontSize: "13px", borderRadius: "4px" }}
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
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Git Repository",
      });
      if (selected && typeof selected === "string") {
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
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [width],
  );

  if (!visible) return null;

  return (
    <div
      className="flex flex-shrink-0 flex-row border-r border-border bg-bg-secondary"
      style={{ width: `${width}px` }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto py-2">
          {workspaces.length === 0 ? <EmptyState onImport={handleImport} /> : <WorkspaceTree />}
        </div>
        <div className="flex-shrink-0 border-t border-border p-2">
          <button
            className="h-8 w-full cursor-pointer bg-bg-tertiary text-text-muted hover:text-[var(--accent)]"
            style={{ fontSize: "13px", borderRadius: "4px" }}
            onClick={handleImport}
          >
            Import Repository
          </button>
        </div>
      </div>
      <div
        className="w-1 flex-shrink-0 cursor-col-resize hover:bg-[var(--accent)] hover:opacity-50"
        onMouseDown={handleMouseDown}
      />
    </div>
  );
}
