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
      'flex max-w-[420px] min-w-[320px] items-start gap-3 rounded-lg border bg-bg-tertiary px-4 py-3 shadow-lg',
    title: 'block text-lg font-medium',
  },
  variants: {
    severity: {
      info: { container: 'border-blue-500/30 shadow-blue-500/10', title: 'text-blue-400' },
      error: { container: 'border-red-500/30 shadow-red-500/10', title: 'text-red-400' },
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
                <Text slot="description" className="mt-1 block text-md text-gray-400">
                  {toast.content.description}
                </Text>
              )}
            </ToastContent>
            <Button slot="close" className="text-md text-gray-500 hover:text-gray-300">
              Dismiss
            </Button>
          </Toast>
        );
      }}
    </ToastRegion>
  );
}
