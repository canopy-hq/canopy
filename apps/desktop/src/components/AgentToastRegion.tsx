import {
  UNSTABLE_ToastRegion as ToastRegion,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContentSlot,
  Text,
} from 'react-aria-components';

import { getTabCollection } from '@superagent/db';
import { useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { containsPtyId } from '../lib/pane-tree-ops';
import { switchTab } from '../lib/tab-actions';
import { agentToastQueue } from '../lib/toast';
import { Button, StatusDot } from './ui';

import type { AgentToastContent } from '../lib/toast';

function eventDescription(type: AgentToastContent['type']): string {
  return type === 'agent-waiting' ? 'is waiting for input' : 'finished';
}

export function AgentToastRegion() {
  const navigate = useNavigate();

  function handleJump(ptyId: number, close: () => void) {
    const tab = getTabCollection().toArray.find((t) => containsPtyId(t.paneRoot, ptyId));
    if (tab) {
      void navigate({
        to: '/workspaces/$workspaceId',
        params: { workspaceId: tab.workspaceItemId },
      });
      switchTab(tab.id);
    }
    close();
  }

  return (
    <ToastRegion
      queue={agentToastQueue}
      className="fixed right-6 bottom-6 z-100 flex w-80 flex-col gap-2"
    >
      {({ toast }) => (
        <Toast
          toast={toast}
          className="rounded-lg border border-border bg-bg-tertiary p-4 font-mono shadow-[0_4px_16px_rgba(0,0,0,0.4)]"
        >
          <ToastContentSlot>
            <div className="flex items-center gap-2">
              <StatusDot
                status={toast.content.type === 'agent-waiting' ? 'waiting' : 'idle'}
                size={8}
              />
              <Text slot="title" className="text-[13px] font-semibold text-text-primary">
                {toast.content.agentName}
              </Text>
              <span className="min-w-0 flex-1 truncate text-right text-[11px] text-text-muted">
                {toast.content.workspace}/{toast.content.branch}
              </span>
              <Button
                slot="close"
                iconOnly
                variant="ghost"
                aria-label="Close notification"
                className="h-5 w-5"
              >
                <X size={10} strokeWidth={2} />
              </Button>
            </div>

            <Text slot="description" className="mt-1 block text-[11px] text-text-muted">
              {eventDescription(toast.content.type)}
            </Text>

            <div className="mt-2 flex gap-3">
              <Button
                variant="link"
                size="sm"
                onPress={() => handleJump(toast.content.ptyId, () => toast.onClose?.())}
              >
                Jump to pane
              </Button>
              <Button
                variant="link"
                size="sm"
                className="text-text-muted"
                onPress={() => toast.onClose?.()}
              >
                Dismiss
              </Button>
            </div>
          </ToastContentSlot>
        </Toast>
      )}
    </ToastRegion>
  );
}
