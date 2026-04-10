import { useCallback, useEffect, useRef, useState } from 'react';

import { useUiState, useProjects } from '../hooks/useCollections';
import { openAddProjectDialog, setSidebarWidth } from '../lib/project-actions';
import { ProjectTree } from './ProjectTree';

export function Sidebar() {
  const ui = useUiState();
  const visible = ui.sidebarVisible;
  const width = ui.sidebarWidth;
  const projects = useProjects();
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const dragAbortRef = useRef<AbortController | null>(null);
  const [isResizing, setIsResizing] = useState(false);

  const handleImport = useCallback(() => openAddProjectDialog(), []);

  useEffect(() => {
    return () => {
      dragAbortRef.current?.abort();
    };
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: width };
      setIsResizing(true);

      dragAbortRef.current?.abort();
      const ac = new AbortController();
      dragAbortRef.current = ac;

      document.addEventListener(
        'mousemove',
        (ev: MouseEvent) => {
          if (!dragRef.current) return;
          setSidebarWidth(dragRef.current.startWidth + (ev.clientX - dragRef.current.startX));
        },
        { signal: ac.signal },
      );

      document.addEventListener(
        'mouseup',
        () => {
          dragRef.current = null;
          setIsResizing(false);
          ac.abort();
        },
        { signal: ac.signal },
      );
    },
    [width],
  );

  if (!visible || projects.length === 0) return null;

  return (
    <>
      {/* Full-screen overlay during resize — locks cursor and blocks hover on other elements */}
      {isResizing && <div className="fixed inset-0 z-[9999]" style={{ cursor: 'col-resize' }} />}
      <div className="flex shrink-0 flex-row bg-raised" style={{ width: `${width}px` }}>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto pb-3">
            <ProjectTree onAddProject={handleImport} />
          </div>
        </div>
        <div className="group relative w-px shrink-0">
          <div className="bg-border/20 pointer-events-none absolute inset-y-0 left-1/2 z-[200] w-px -translate-x-1/2 transition-all group-hover:w-[3px] group-hover:bg-accent" />
          <div
            className="absolute inset-0 -right-[4px] -left-[4px] z-50"
            style={{ cursor: 'col-resize' }}
            onMouseDown={handleMouseDown}
          />
        </div>
      </div>
    </>
  );
}
