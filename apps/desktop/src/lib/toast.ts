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
  workspace: string;
  branch: string;
  ptyId: number;
}

export const agentToastQueue = new ToastQueue<AgentToastContent>({ maxVisibleToasts: 3 });

export function showAgentToast(content: AgentToastContent) {
  const timeout = content.type === 'agent-complete' ? 10000 : undefined;
  agentToastQueue.add(content, { timeout });
}

// De-duplication: suppress duplicate toasts for same ptyId within 5s
const lastToastTime: Record<number, number> = {};

export function showAgentToastDeduped(content: AgentToastContent) {
  const now = Date.now();
  const last = lastToastTime[content.ptyId] ?? 0;
  if (now - last < 5000) return; // suppress within 5s window
  lastToastTime[content.ptyId] = now;
  showAgentToast(content);
}
