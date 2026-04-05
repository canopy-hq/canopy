import { useCallback } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { Button } from './Button';

export function ConfirmModal({
  title,
  description,
  confirmLabel = 'Confirm',
  confirmVariant = 'primary',
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'destructive';
  onConfirm: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div className="w-[420px] rounded-lg border border-border/60 bg-bg-secondary p-5">
        <Dialog className="outline-none" aria-label={title}>
          <Heading slot="title" className="font-mono text-base font-medium text-text-primary">
            {title}
          </Heading>
          {description != null && (
            <p className="mt-2 text-sm leading-relaxed text-text-muted">{description}</p>
          )}
          {children}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button variant={confirmVariant} onPress={onConfirm}>
              {confirmLabel}
            </Button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
