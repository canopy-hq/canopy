import { useState, useEffect, useCallback } from 'react';
import { Dialog, Heading } from 'react-aria-components';
import type { Workspace } from '../stores/workspace-store';
import { useWorkspaceStore } from '../stores/workspace-store';

export interface CreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
}

function TypeCard({
  selected,
  onClick,
  icon,
  iconColor,
  label,
}: {
  selected: boolean;
  onClick: () => void;
  icon: string;
  iconColor: string;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-1 p-4 rounded-lg ${
        selected
          ? 'border-2 border-[var(--accent)] bg-[var(--bg-tertiary)]'
          : 'border border-[var(--border)] hover:border-[var(--text-muted)] bg-[var(--bg-tertiary)]'
      }`}
    >
      <span style={{ color: iconColor, fontSize: '20px' }}>{icon}</span>
      <span className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
    </button>
  );
}

export function CreateModal({ isOpen, onClose, workspace }: CreateModalProps) {
  const [type, setType] = useState<'branch' | 'worktree'>('branch');
  const [name, setName] = useState('');
  const [baseBranch, setBaseBranch] = useState('');

  const createBranch = useWorkspaceStore((s) => s.createBranch);
  const createWorktree = useWorkspaceStore((s) => s.createWorktree);

  // Initialize baseBranch to HEAD branch on open
  useEffect(() => {
    if (isOpen) {
      const head = workspace.branches.find((b) => b.is_head);
      setBaseBranch(head?.name ?? workspace.branches[0]?.name ?? '');
      setName('');
      setType('branch');
    }
  }, [isOpen, workspace.branches]);

  // Close on Esc
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    try {
      if (type === 'branch') {
        await createBranch(workspace.id, trimmedName, baseBranch);
      } else {
        const wtPath = `~/.superagent/worktrees/${workspace.name}-${trimmedName}`;
        await createWorktree(workspace.id, trimmedName, wtPath, baseBranch);
      }
      onClose();
    } catch {
      // Error toast handled by store actions
    }
  }

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
        <Dialog className="outline-none" aria-label="Create Branch or Worktree">
          <Heading slot="title" className="text-[16px] font-semibold text-[var(--text-primary)]">
            Create Branch or Worktree
          </Heading>

          {/* Type cards */}
          <div className="flex gap-2 mt-4">
            <TypeCard
              selected={type === 'branch'}
              onClick={() => setType('branch')}
              icon={'\u2387'}
              iconColor="var(--branch-icon)"
              label="Branch"
            />
            <TypeCard
              selected={type === 'worktree'}
              onClick={() => setType('worktree')}
              icon={'\u25C6'}
              iconColor="var(--worktree-icon)"
              label="Worktree"
            />
          </div>

          {/* Name input */}
          <label className="block mt-4">
            <span className="text-[13px] text-[var(--text-primary)]">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feature/my-branch"
              autoFocus
              className="w-full h-9 mt-1 px-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] outline-none"
            />
          </label>

          {/* Base branch select */}
          <label className="block mt-4">
            <span className="text-[13px] text-[var(--text-primary)]">Base branch</span>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="w-full h-9 mt-1 px-2 bg-[var(--bg-tertiary)] border border-[var(--border)] rounded-lg text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            >
              {workspace.branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.is_head ? ' (HEAD)' : ''}
                </option>
              ))}
            </select>
          </label>

          {/* Worktree path (only when type=worktree) */}
          {type === 'worktree' && (
            <div className="mt-4">
              <span className="text-[13px] text-[var(--text-primary)]">Worktree path</span>
              <div className="text-[11px] text-[var(--text-muted)] mt-1">
                ~/.superagent/worktrees/{workspace.name}-{name || '...'}
              </div>
            </div>
          )}

          {/* Git command preview */}
          <div className="mt-3 p-3 bg-[var(--bg-primary)] rounded-lg">
            <code
              className="text-[11px] text-[var(--text-muted)]"
              style={{ fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}
            >
              {type === 'branch'
                ? `git branch ${name || '<name>'} ${baseBranch}`
                : `git worktree add ~/.superagent/worktrees/${workspace.name}-${name || '<name>'} -b ${name || '<name>'}`}
            </code>
          </div>

          {/* Action buttons */}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={onClose}
              className="h-8 px-4 rounded-lg bg-[var(--bg-tertiary)] text-[var(--text-muted)] text-[13px]"
            >
              Discard
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim()}
              className="h-8 px-4 rounded-lg bg-[var(--accent)] text-white text-[13px] disabled:opacity-50"
            >
              {type === 'branch' ? 'Create Branch' : 'Create Worktree'}
            </button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
