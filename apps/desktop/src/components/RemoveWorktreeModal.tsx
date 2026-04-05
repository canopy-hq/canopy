import { useState, useCallback } from 'react';
import { Dialog, Heading } from 'react-aria-components';

import { Button } from './ui';

export interface RemoveWorktreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (alsoDeleteGit: boolean) => void;
  worktreeName: string;
}

export function RemoveWorktreeModal({
  isOpen,
  onClose,
  onConfirm,
  worktreeName,
}: RemoveWorktreeModalProps) {
  const [deleteGit, setDeleteGit] = useState(false);

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
        <Dialog className="outline-none" aria-label="Remove Worktree">
          <Heading slot="title" className="font-mono text-base font-medium text-text-primary">
            Remove &ldquo;{worktreeName}&rdquo;
          </Heading>

          <p className="mt-2 text-sm leading-relaxed text-text-muted">
            Removes the worktree from the sidebar. You can re-open it later from the workspace
            palette.
          </p>

          <label className="mt-4 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={deleteGit}
              onChange={(e) => setDeleteGit(e.target.checked)}
              className="accent-destructive"
            />
            <span className="text-sm text-text-muted">Also delete the git worktree from disk</span>
          </label>

          {deleteGit && (
            <p className="mt-2 text-sm leading-relaxed text-destructive/80">
              Runs{' '}
              <code className="rounded-sm bg-bg-tertiary px-1 font-mono">git worktree remove</code>{' '}
              and deletes the working directory. Uncommitted changes will be lost.
            </p>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="secondary" onPress={onClose}>
              Cancel
            </Button>
            <Button
              variant={deleteGit ? 'destructive' : 'primary'}
              onPress={() => onConfirm(deleteGit)}
            >
              {deleteGit ? 'Delete Worktree' : 'Remove from Sidebar'}
            </Button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
