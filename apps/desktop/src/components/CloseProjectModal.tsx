import { useCallback } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { Button } from './ui';

export interface CloseProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  projectName: string;
}

export function CloseProjectModal({
  isOpen,
  onClose,
  onConfirm,
  projectName,
}: CloseProjectModalProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

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
        <Dialog className="outline-none" aria-label="Close Project">
          <Heading slot="title" className="font-mono text-base font-medium text-text-primary">
            Close &ldquo;{projectName}&rdquo;
          </Heading>

          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            Closes all workspaces inside this project and kills all active terminals. Files and git
            history remain on disk.
          </p>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button variant="destructive" onPress={onConfirm}>
              Close Project
            </Button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
