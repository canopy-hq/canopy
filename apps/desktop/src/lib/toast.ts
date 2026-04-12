import { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components';

export interface ToastContent {
  title: string;
  description?: string;
  severity?: 'error' | 'info';
}

export const toastQueue = new ToastQueue<ToastContent>({ maxVisibleToasts: 5 });

export function showErrorToast(title: string, description?: string) {
  toastQueue.add({ title, description, severity: 'error' }, { timeout: 8000 });
}

export function showInfoToast(title: string, description?: string) {
  toastQueue.add({ title, description, severity: 'info' }, { timeout: 3000 });
}

// ── Agent toast system ──────────────────────────────────────────────

export interface AgentToastContent {
  type: 'agent-complete' | 'agent-waiting';
  agentName: string;
  project: string;
  branch: string;
  ptyId: number;
}

export const agentToastQueue = new ToastQueue<AgentToastContent>({ maxVisibleToasts: 3 });

// Track active agent toasts: ptyId → toast key (prevents duplicates)
const activeAgentToasts = new Map<number, string>();

export function showAgentToastDeduped(content: AgentToastContent) {
  if (activeAgentToasts.has(content.ptyId)) return;

  const timeout = content.type === 'agent-complete' ? 10000 : undefined;
  const key = agentToastQueue.add(content, {
    timeout,
    onClose: () => activeAgentToasts.delete(content.ptyId),
  });
  activeAgentToasts.set(content.ptyId, key);
}

export function dismissAgentToast(ptyId: number) {
  const key = activeAgentToasts.get(ptyId);
  if (key) agentToastQueue.close(key);
}

export function dismissAgentToastsForPtyIds(ptyIds: number[]) {
  for (const id of ptyIds) dismissAgentToast(id);
}
