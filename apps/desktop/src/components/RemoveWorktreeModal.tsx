import { useState, useCallback } from 'react';
import { Dialog, Heading } from 'react-aria-components';

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
      <div className="w-[480px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <Dialog className="outline-none" aria-label="Remove Worktree">
          <Heading slot="title" className="text-[16px] font-semibold text-[var(--text-primary)]">
            Remove &ldquo;{worktreeName}&rdquo;
          </Heading>

          <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-muted)]">
            This will remove the worktree from the sidebar. You can re-open it later from the
            workspace palette.
          </p>

          <label className="mt-4 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={deleteGit}
              onChange={(e) => setDeleteGit(e.target.checked)}
              className="accent-[var(--destructive)]"
            />
            <span className="text-[13px] text-[var(--text-muted)]">
              Also delete the git worktree from disk
            </span>
          </label>

          {deleteGit && (
            <p className="mt-2 text-[12px] leading-relaxed text-[var(--destructive)]">
              This will run{' '}
              <code className="rounded bg-[var(--bg-tertiary)] px-1">git worktree remove</code> and
              delete the working directory. Uncommitted changes will be lost.
            </p>
          )}

          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="h-8 cursor-pointer rounded-lg bg-[var(--bg-tertiary)] px-4 text-[13px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(deleteGit)}
              className={`h-8 cursor-pointer rounded-lg px-4 text-[13px] font-medium text-white hover:opacity-90 ${
                deleteGit ? 'bg-[var(--destructive)]' : 'bg-[var(--accent)]'
              }`}
            >
              {deleteGit ? 'Delete Worktree' : 'Remove from Sidebar'}
            </button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
