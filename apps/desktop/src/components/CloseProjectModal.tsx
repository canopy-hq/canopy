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
      <div className="w-[480px] rounded-lg border border-border bg-bg-secondary p-6">
        <Dialog className="outline-none" aria-label="Close Project">
          <Heading slot="title" className="text-[16px] font-semibold text-text-primary">
            Close Project &ldquo;{projectName}&rdquo;
          </Heading>

          <p className="mt-3 text-base leading-relaxed text-text-muted">
            This will close all workspaces inside this project and kill all active terminals. Your
            files and git history will remain on disk.
          </p>

          <div className="mt-6 flex justify-end gap-2">
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
