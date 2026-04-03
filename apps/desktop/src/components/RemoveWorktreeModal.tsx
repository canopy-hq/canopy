import { useState, useCallback } from 'react';
import { Dialog, Heading } from 'react-aria-components';

export interface RemoveWorktreeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (alsoDeleteGit: boolean) => void;
  worktreeName: string;
}

export function RemoveWorktreeModal({ isOpen, onClose, onConfirm, worktreeName }: RemoveWorktreeModalProps) {
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
      <div className="w-[480px] bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-6">
        <Dialog className="outline-none" aria-label="Remove Worktree">
          <Heading slot="title" className="text-[16px] font-semibold text-[var(--text-primary)]">
            Remove &ldquo;{worktreeName}&rdquo;
          </Heading>

          <p className="mt-3 text-[13px] text-[var(--text-muted)] leading-relaxed">
            This will remove the worktree from the sidebar. You can re-open it later from the workspace palette.
          </p>

          <label className="flex items-center gap-2 mt-4 cursor-pointer">
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
            <p className="mt-2 text-[12px] text-[var(--destructive)] leading-relaxed">
              This will run <code className="bg-[var(--bg-tertiary)] px-1 rounded">git worktree remove</code> and delete the working directory. Uncommitted changes will be lost.
            </p>
          )}

          <div className="flex justify-end gap-2 mt-6">
            <button
              onClick={onClose}
              className="h-8 px-4 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[13px] hover:text-[var(--text-primary)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => onConfirm(deleteGit)}
              className={`h-8 px-4 rounded-lg text-white text-[13px] font-medium hover:opacity-90 cursor-pointer ${
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
