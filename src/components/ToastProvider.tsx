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
    <ToastRegion
      queue={toastQueue}
      className="fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {({ toast }) => (
        <Toast
          toast={toast}
          className="flex items-start gap-3 rounded-lg border border-red-500/30 bg-[#1a1a2e] px-4 py-3 shadow-lg shadow-red-500/10"
          style={{ minWidth: '320px', maxWidth: '420px' }}
        >
          <ToastContent className="flex-1">
            <Text
              slot="title"
              className="block text-sm font-medium text-red-400"
            >
              {toast.content.title}
            </Text>
            {toast.content.description && (
              <Text
                slot="description"
                className="mt-1 block text-xs text-gray-400"
              >
                {toast.content.description}
              </Text>
            )}
          </ToastContent>
          <Button
            slot="close"
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            Dismiss
          </Button>
        </Toast>
      )}
    </ToastRegion>
  );
}
