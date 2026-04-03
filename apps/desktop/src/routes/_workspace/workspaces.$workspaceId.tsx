import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { TabBar } from '../../components/TabBar';
import { PaneContainer } from '../../components/PaneContainer';
import { useUiState, useTabs } from '../../hooks/useCollections';
import { setActiveContext, addTab } from '../../lib/tab-actions';
import { toggleSidebar } from '../../lib/workspace-actions';

function WorkspaceRoute() {
  const { workspaceId } = Route.useParams();
  const ui = useUiState();
  const allTabs = useTabs();
  const activeTab = allTabs.find((t) => t.id === ui.activeTabId);

  // Sync store state when navigating to a workspace URL directly (routing is source of truth)
  useEffect(() => {
    if (ui.activeContextId !== workspaceId) {
      setActiveContext(workspaceId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  return (
    <>
      <TabBar />
      <div className="flex-1 min-h-0 relative">
        {activeTab ? (
          <div key={activeTab.id} className="absolute inset-0">
            <PaneContainer root={activeTab.paneRoot} />
          </div>
        ) : (
          <EmptyState />
        )}
      </div>
    </>
  );
}

function KbdBadge({ children }: { children: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '22px',
        height: '22px',
        padding: '0 5px',
        borderRadius: '5px',
        fontSize: '12px',
        lineHeight: 1,
        backgroundColor: 'var(--bg-tertiary)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
      }}
    >
      {children}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-1 select-none h-full">
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '42px',
          letterSpacing: '-2px',
          color: 'var(--text-muted)',
          opacity: 0.25,
          marginBottom: '32px',
          fontWeight: 600,
        }}
      >
        {'{ }'}
      </div>

      <button
        onClick={addTab}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '320px',
          gap: '12px',
          padding: '10px 16px',
          borderRadius: '8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '14px',
        }}
        className="hover:bg-bg-secondary hover:text-text-primary transition-colors"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <rect x="1" y="2.5" width="14" height="11" rx="2" />
          <path d="M4.5 6l2.5 2-2.5 2" />
          <path d="M9 10h3" />
        </svg>
        <span style={{ flex: 1, textAlign: 'left' }}>New Terminal</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <KbdBadge>⌘</KbdBadge>
          <KbdBadge>T</KbdBadge>
        </div>
      </button>

      <button
        onClick={() => toggleSidebar()}
        style={{
          display: 'flex',
          alignItems: 'center',
          width: '320px',
          gap: '12px',
          padding: '10px 16px',
          borderRadius: '8px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: '14px',
        }}
        className="hover:bg-bg-secondary hover:text-text-primary transition-colors"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <rect x="1" y="1" width="14" height="14" rx="2" />
          <path d="M6 1v14" />
        </svg>
        <span style={{ flex: 1, textAlign: 'left' }}>Toggle Sidebar</span>
        <div style={{ display: 'flex', gap: '4px' }}>
          <KbdBadge>⌘</KbdBadge>
          <KbdBadge>B</KbdBadge>
        </div>
      </button>
    </div>
  );
}

export const Route = createFileRoute('/_workspace/workspaces/$workspaceId')({
  component: WorkspaceRoute,
});
