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
      <div className="w-[480px] rounded-lg border border-border bg-bg-secondary p-6">
        <Dialog className="outline-none" aria-label="Remove Worktree">
          <Heading slot="title" className="text-[16px] font-semibold text-text-primary">
            Remove &ldquo;{worktreeName}&rdquo;
          </Heading>

          <p className="ui-base mt-3 leading-relaxed text-text-muted">
            This will remove the worktree from the sidebar. You can re-open it later from the
            workspace palette.
          </p>

          <label className="mt-4 flex items-center gap-2">
            <input
              type="checkbox"
              checked={deleteGit}
              onChange={(e) => setDeleteGit(e.target.checked)}
              className="accent-destructive"
            />
            <span className="ui-base text-text-muted">Also delete the git worktree from disk</span>
          </label>

          {deleteGit && (
            <p className="ui-md mt-2 leading-relaxed text-destructive">
              This will run <code className="rounded bg-bg-tertiary px-1">git worktree remove</code>{' '}
              and delete the working directory. Uncommitted changes will be lost.
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
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
