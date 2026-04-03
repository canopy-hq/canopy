import {
  UNSTABLE_ToastRegion as ToastRegion,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContentSlot,
  Text,
  Button,
} from 'react-aria-components';

import { getTabCollection } from '@superagent/db';
import { useNavigate } from '@tanstack/react-router';

import { switchTab } from '../lib/tab-actions';
import { agentToastQueue } from '../lib/toast';
import { StatusDot } from './StatusDot';

import type { PaneNode } from '../lib/pane-tree-ops';
import type { AgentToastContent } from '../lib/toast';

/** Recursively check if a pane tree contains a leaf with the given ptyId */
function containsPtyId(node: PaneNode, ptyId: number): boolean {
  if (node.type === 'leaf') return node.ptyId === ptyId;
  return node.children.some((child) => containsPtyId(child, ptyId));
}

function eventDescription(type: AgentToastContent['type']): string {
  return type === 'agent-waiting' ? 'is waiting for input' : 'finished';
}

export function AgentToastRegion() {
  const navigate = useNavigate();

  function handleJump(ptyId: number, close: () => void) {
    const tab = getTabCollection().toArray.find((t) => containsPtyId(t.paneRoot, ptyId));
    if (tab) {
      void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: tab.workspaceItemId } });
      switchTab(tab.id);
    }
    close();
  }

  return (
    <ToastRegion
      queue={agentToastQueue}
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        zIndex: 100,
        width: '320px',
      }}
    >
      {({ toast }) => (
        <Toast
          toast={toast}
          style={{
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
            padding: '16px',
            fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          }}
        >
          <ToastContentSlot>
            {/* Row 1: StatusDot + Agent name + workspace/branch + close */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <StatusDot
                status={toast.content.type === 'agent-waiting' ? 'waiting' : 'idle'}
                size={8}
              />
              <Text
                slot="title"
                style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}
              >
                {toast.content.agentName}
              </Text>
              <span
                style={{
                  flex: 1,
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  textAlign: 'right',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {toast.content.workspace}/{toast.content.branch}
              </span>
              <Button
                slot="close"
                aria-label="Close notification"
                style={{
                  fontSize: '10px',
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0 2px',
                  lineHeight: 1,
                }}
              >
                x
              </Button>
            </div>

            {/* Row 2: Event description */}
            <Text
              slot="description"
              style={{
                display: 'block',
                fontSize: '11px',
                color: 'var(--text-muted)',
                marginTop: '4px',
              }}
            >
              {eventDescription(toast.content.type)}
            </Text>

            {/* Row 3: Actions */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button
                onClick={() => handleJump(toast.content.ptyId, () => toast.onClose?.())}
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  color: 'var(--accent)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.textDecoration = 'none';
                }}
              >
                Jump to pane
              </button>
              <button
                aria-label="Dismiss"
                onClick={() => toast.onClose?.()}
                style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  textDecoration: 'none',
                }}
                onMouseEnter={(e) => {
                  (e.target as HTMLButtonElement).style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                  (e.target as HTMLButtonElement).style.textDecoration = 'none';
                }}
              >
                Dismiss
              </button>
            </div>
          </ToastContentSlot>
        </Toast>
      )}
    </ToastRegion>
  );
}
