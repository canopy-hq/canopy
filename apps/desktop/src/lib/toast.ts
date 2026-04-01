import { UNSTABLE_ToastQueue as ToastQueue } from 'react-aria-components';

export interface ToastContent {
  title: string;
  description?: string;
}

export const toastQueue = new ToastQueue<ToastContent>({
  maxVisibleToasts: 5,
});

export function showErrorToast(title: string, description?: string) {
  toastQueue.add({ title, description }, { timeout: 8000 });
}
