import { useState } from 'react';

import { ConfirmModal } from '@superagent/ui';

export interface RemoveWorktreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (alsoDeleteGit: boolean) => void;
  worktreeName: string;
  branch: string;
}

export function RemoveWorktreeModal({
  isOpen,
  onClose,
  onConfirm,
  worktreeName,
  branch,
}: RemoveWorktreeModalProps) {
  const [deleteGit, setDeleteGit] = useState(true);

  if (!isOpen) return null;

  return (
    <ConfirmModal
      title={`Remove "${worktreeName}"`}
      description="Removes the worktree from the sidebar. You can re-open it later from the project palette."
      confirmLabel={deleteGit ? 'Delete Worktree & Branch' : 'Remove from Sidebar'}
      confirmVariant={deleteGit ? 'destructive' : 'primary'}
      onConfirm={() => onConfirm(deleteGit)}
      onClose={onClose}
    >
      <label className="mt-4 flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={deleteGit}
          onChange={(e) => setDeleteGit(e.target.checked)}
          className="accent-destructive"
        />
        <span className="text-sm text-text-muted">
          Also delete the working directory and local branch{branch ? ` (${branch})` : ''}
        </span>
      </label>
      {deleteGit && (
        <p className="mt-2 text-sm leading-relaxed text-destructive/80">
          Runs <code className="rounded-sm bg-bg-tertiary px-1 font-mono">git worktree remove</code>{' '}
          and <code className="rounded-sm bg-bg-tertiary px-1 font-mono">git branch -d</code>.
          Uncommitted changes will be lost.
        </p>
      )}
    </ConfirmModal>
  );
}
