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
