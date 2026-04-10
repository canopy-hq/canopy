import {
  UNSTABLE_ToastRegion as ToastRegion,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  Text,
  Button,
} from 'react-aria-components';

import { tv } from 'tailwind-variants';

import { toastQueue } from '../lib/toast';

const toastVariants = tv({
  slots: {
    container:
      'flex max-w-[420px] min-w-[320px] items-start gap-3 rounded-lg border bg-surface px-4 py-3 shadow-lg',
    title: 'block text-lg font-medium',
  },
  variants: {
    severity: {
      info: { container: 'border-focus/30 shadow-focus/10', title: 'text-focus' },
      error: { container: 'border-danger/30 shadow-danger/10', title: 'text-danger' },
    },
  },
});

export function ErrorToastRegion() {
  return (
    <ToastRegion queue={toastQueue} className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {({ toast }) => {
        const severity = toast.content.severity === 'info' ? 'info' : 'error';
        const { container, title } = toastVariants({ severity });
        return (
          <Toast toast={toast} className={container()}>
            <ToastContent className="flex-1">
              <Text slot="title" className={title()}>
                {toast.content.title}
              </Text>
              {toast.content.description && (
                <Text slot="description" className="mt-1 block text-md text-fg-muted">
                  {toast.content.description}
                </Text>
              )}
            </ToastContent>
            <Button slot="close" className="text-md text-fg-faint hover:text-fg-muted">
              Dismiss
            </Button>
          </Toast>
        );
      }}
    </ToastRegion>
  );
}
