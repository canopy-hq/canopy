import {
  UNSTABLE_ToastRegion as ToastRegion,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  Text,
  Button,
} from 'react-aria-components';

import { toastQueue } from '../lib/toast';

export function ErrorToastRegion() {
  return (
    <ToastRegion queue={toastQueue} className="fixed right-4 bottom-4 z-50 flex flex-col gap-2">
      {({ toast }) => {
        const isInfo = toast.content.severity === 'info';
        return (
          <Toast
            toast={toast}
            className={`flex max-w-[420px] min-w-[320px] items-start gap-3 rounded-lg border bg-bg-tertiary px-4 py-3 shadow-lg ${
              isInfo
                ? 'border-blue-500/30 shadow-blue-500/10'
                : 'border-red-500/30 shadow-red-500/10'
            }`}
          >
            <ToastContent className="flex-1">
              <Text
                slot="title"
                className={`block text-lg font-medium ${isInfo ? 'text-blue-400' : 'text-red-400'}`}
              >
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
