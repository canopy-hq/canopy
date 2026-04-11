import { ConfirmModal } from '@canopy/ui';

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
  if (!isOpen) return null;
  return (
    <ConfirmModal
      title={`Close "${projectName}"`}
      description="Closes all workspaces inside this project and kills all active terminals. Files and git history remain on disk."
      confirmLabel="Close project"
      confirmVariant="destructive"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
}
