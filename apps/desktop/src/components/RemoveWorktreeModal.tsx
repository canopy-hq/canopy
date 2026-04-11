import { useState } from 'react';

import { ConfirmModal } from '@canopy/ui';
import { Check } from 'lucide-react';
import { tv } from 'tailwind-variants';

const checkbox = tv({
  base: 'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
  variants: {
    checked: {
      true: 'border-destructive/50 bg-destructive/10',
      false: 'border-border/50 bg-bg-primary/50',
    },
  },
});

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
      <label className="mt-4 flex cursor-pointer items-start gap-2.5">
        <div className={checkbox({ checked: deleteGit })}>
          {deleteGit && <Check size={10} strokeWidth={2.5} className="text-destructive" />}
        </div>
        <input
          type="checkbox"
          checked={deleteGit}
          onChange={(e) => setDeleteGit(e.target.checked)}
          className="sr-only"
        />
        <span className="text-sm leading-relaxed text-text-muted">
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
