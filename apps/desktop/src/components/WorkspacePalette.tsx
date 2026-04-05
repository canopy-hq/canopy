import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal, ModalOverlay } from 'react-aria-components';

import { tv } from 'tailwind-variants';

import {
  listAllBranches,
  listWorktrees,
  fetchRemote,
  sanitizeWorktreeName,
  buildWorktreePath,
  type BranchDetail,
  type WorktreeInfo,
} from '../lib/git';
import { createWorktree, openWorktree } from '../lib/workspace-actions';
import { Badge, Button, Kbd } from './ui';

import type { Workspace } from '@superagent/db';

export interface WorkspacePaletteProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
}

type Tab = 'all' | 'worktrees';

const tabButton = tv({
  base: 'flex flex-1 items-center justify-center gap-1 rounded border-none px-2 py-1.25 ui-md',
  variants: {
    active: { true: 'bg-bg-tertiary text-text-primary', false: 'bg-transparent text-text-muted' },
  },
});

const branchItemRow = tv({
  base: 'flex items-center gap-1.75 rounded-[5px] px-2 py-1.5',
  variants: {
    disabled: { true: 'opacity-50', false: '' },
    isConfirming: { true: 'bg-accent/[0.08]', false: '' },
  },
});

export function WorkspacePalette({ isOpen, onClose, workspace }: WorkspacePaletteProps) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [allWorktrees, setAllWorktrees] = useState<WorktreeInfo[]>([]);
  const [baseBranch, setBaseBranch] = useState('');
  const [pickingBase, setPickingBase] = useState(false);
  const [confirmBranch, setConfirmBranch] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    let stale = false;
    setQuery('');
    setTab('all');
    setConfirmBranch(null);
    setPickingBase(false);
    // Show cached branches immediately, then replace with fresh data after fetch
    listAllBranches(workspace.path)
      .then((b) => {
        if (!stale) setBranches(b);
      })
      .catch(() => {});
    listWorktrees(workspace.path)
      .then(setAllWorktrees)
      .catch(() => {});
    fetchRemote(workspace.path)
      .then(() => listAllBranches(workspace.path))
      .then((b) => {
        if (!stale) setBranches(b);
      })
      .catch((e) => console.warn('[WorkspacePalette] fetch remote failed:', e));
    const head = workspace.branches.find((b) => b.is_head);
    setBaseBranch(head?.name ?? 'main');
    requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      stale = true;
    };
  }, [isOpen, workspace]);

  const lowerQuery = useMemo(() => query.toLowerCase(), [query]);

  const filteredBranches = useMemo(
    () => branches.filter((b) => b.name.toLowerCase().includes(lowerQuery)),
    [branches, lowerQuery],
  );
  const exactMatch = useMemo(
    () => branches.find((b) => b.name.toLowerCase() === lowerQuery.trim()),
    [branches, lowerQuery],
  );
  const isCreateMode = query.trim().length > 0 && !exactMatch;

  const sanitizedName = useMemo(() => sanitizeWorktreeName(query), [query]);

  const sidebarNames = useMemo(
    () => new Set(workspace.worktrees.map((wt) => wt.name)),
    [workspace.worktrees],
  );
  const diskWorktrees = useMemo(
    () => allWorktrees.map((wt) => ({ ...wt, isInSidebar: sidebarNames.has(wt.name) })),
    [allWorktrees, sidebarNames],
  );
  const filteredWorktrees = useMemo(
    () => diskWorktrees.filter((wt) => wt.name.toLowerCase().includes(lowerQuery)),
    [diskWorktrees, lowerQuery],
  );

  const handleCreateWorktree = useCallback(
    async (branchName?: string) => {
      const wtName = branchName ? sanitizeWorktreeName(branchName) : sanitizedName;
      if (!wtName) return;
      const wtPath = buildWorktreePath(workspace.name, wtName);
      const newBranch = branchName ? undefined : wtName;
      await createWorktree(workspace.id, wtName, wtPath, branchName ?? baseBranch, newBranch);
      onClose();
    },
    [sanitizedName, workspace, baseBranch, onClose],
  );

  function handleOpenWorktree(name: string, path: string, branch: string) {
    openWorktree(workspace.id, name, path, branch);
    onClose();
  }

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickingBase) {
          setPickingBase(false);
        } else if (confirmBranch) {
          setConfirmBranch(null);
        } else {
          onClose();
        }
      }
      if (e.key === 'Enter' && e.metaKey && isCreateMode) {
        void handleCreateWorktree();
      }
    },
    [onClose, pickingBase, confirmBranch, isCreateMode, handleCreateWorktree],
  );

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      isDismissable
      isKeyboardDismissDisabled
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[20vh]"
    >
      <Modal className="w-[440px] overflow-hidden rounded-[10px] border border-border bg-bg-primary shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
        {/* Search bar */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="var(--accent)"
            strokeWidth="1.5"
          >
            <circle cx="7" cy="7" r="4" />
            <path d="M10 10l3 3" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setConfirmBranch(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search or create new branch..."
            className="ui-lg flex-1 border-none bg-transparent text-text-primary outline-none"
          />
          <Kbd>ESC</Kbd>
        </div>

        {/* Create card */}
        {isCreateMode && !pickingBase && (
          <div className="mx-2 mt-2 rounded-lg border border-accent/[0.15] bg-accent/[0.05] p-3">
            <div className="mb-2 flex items-center gap-2">
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="1.5"
              >
                <path d="M8 3v10M3 8h10" />
              </svg>
              <span className="ui-base flex-1 font-medium text-accent">
                Create &ldquo;{sanitizedName}&rdquo;
              </span>
              <span className="flex items-center gap-0.5">
                <Kbd>⌘</Kbd>
                <Kbd>↩</Kbd>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="ui-sm text-text-muted">from</span>
              <button
                onClick={() => setPickingBase(true)}
                className="ui-sm flex items-center gap-1 rounded-[5px] border border-border bg-bg-tertiary px-2 py-0.5"
              >
                <svg
                  width="9"
                  height="9"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                >
                  <circle cx="8" cy="8" r="3" />
                </svg>
                <span className="font-medium text-text-primary">{baseBranch}</span>
                <svg width="8" height="8" viewBox="0 0 16 16" fill="var(--text-muted)">
                  <path d="M4 6l4 4 4-4z" />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="mx-2 mt-2 flex gap-0.5 rounded-[6px] bg-bg-primary p-0.5">
          <button onClick={() => setTab('all')} className={tabButton({ active: tab === 'all' })}>
            All{' '}
            <span className="ui-xs rounded-full bg-white/[0.06] px-1.25">{branches.length}</span>
          </button>
          <button
            onClick={() => setTab('worktrees')}
            className={tabButton({ active: tab === 'worktrees' })}
          >
            Worktrees{' '}
            <span className="ui-xs rounded-full bg-white/[0.06] px-1.25">
              {diskWorktrees.length}
            </span>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[320px] overflow-y-auto px-2 pb-2">
          {tab === 'all' && !pickingBase && (
            <>
              <div className="ui-xs px-2 pt-1.5 pb-1 tracking-[0.5px] text-text-muted uppercase">
                Branches
              </div>
              {filteredBranches.length === 0 && (
                <div className="ui-md py-3 text-center text-text-muted">
                  {query ? `No branches match "${query}"` : 'No branches'}
                </div>
              )}
              {filteredBranches.map((b) => (
                <BranchItem
                  key={b.name}
                  branch={b}
                  isConfirming={confirmBranch === b.name}
                  workspace={workspace}
                  onCreateWT={() => {
                    if (b.is_head || b.is_in_worktree) return;
                    setConfirmBranch(b.name);
                  }}
                  onConfirmCreate={() => handleCreateWorktree(b.name)}
                  onCancelConfirm={() => setConfirmBranch(null)}
                />
              ))}
              <div className="ui-xs mt-1 border-t border-border px-2 pt-1.5 pb-1 tracking-[0.5px] text-text-muted uppercase">
                Worktrees
              </div>
              {filteredWorktrees.length === 0 && (
                <div className="ui-md py-3 text-center text-text-muted">No worktrees</div>
              )}
              {filteredWorktrees.map((wt) => (
                <WorktreeItem
                  key={wt.name}
                  worktree={wt}
                  onOpen={() => handleOpenWorktree(wt.name, wt.path, wt.branch)}
                  isInSidebar={wt.isInSidebar}
                />
              ))}
            </>
          )}

          {tab === 'worktrees' && (
            <>
              {filteredWorktrees.length === 0 && (
                <div className="px-4 py-8 text-center">
                  <div className="ui-base mb-1 text-text-muted">No worktrees</div>
                  <div className="ui-md text-text-muted">Create one from the All tab</div>
                </div>
              )}
              {filteredWorktrees.map((wt) => (
                <WorktreeItem
                  key={wt.name}
                  worktree={wt}
                  onOpen={() => handleOpenWorktree(wt.name, wt.path, wt.branch)}
                  showPath
                  isInSidebar={wt.isInSidebar}
                />
              ))}
              {filteredWorktrees.length > 0 && (
                <div className="ui-md mt-1 border-t border-border p-2 text-center text-text-muted">
                  Worktrees already on disk. Click Open to add to sidebar.
                </div>
              )}
            </>
          )}

          {pickingBase && (
            <>
              <div className="ui-xs px-2 pt-1.5 pb-1 tracking-[0.5px] text-text-muted uppercase">
                Select base branch
              </div>
              {branches
                .filter((b) => !b.is_in_worktree)
                .map((b) => (
                  <div
                    key={b.name}
                    className={`flex items-center gap-1.75 rounded-[5px] px-2 py-1.5 hover:bg-accent/[0.06] ${b.name === baseBranch ? 'bg-accent/[0.06]' : ''}`}
                    onClick={() => {
                      setBaseBranch(b.name);
                      setPickingBase(false);
                    }}
                  >
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke={b.name === baseBranch ? 'var(--accent)' : 'var(--text-muted)'}
                      strokeWidth="2"
                    >
                      <circle cx="8" cy="8" r="3" />
                    </svg>
                    <span
                      className={`ui-base text-text-primary ${b.name === baseBranch ? 'font-medium' : 'font-normal'}`}
                    >
                      {b.name}
                    </span>
                    {b.is_head && <Badge color="accent">HEAD</Badge>}
                    {b.name === baseBranch && (
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="var(--accent)"
                        className="ml-auto"
                      >
                        <path d="M6 10.8l-2.4-2.4L2 10l4 4 8-8-1.6-1.6z" />
                      </svg>
                    )}
                  </div>
                ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="ui-sm flex items-center gap-3 border-t border-border px-4 py-2 text-text-muted">
          {isCreateMode ? (
            <>
              <span className="flex items-center gap-0.5">
                <Kbd>⌘</Kbd>
                <Kbd>↩</Kbd> create worktree
              </span>
              <span className="ui-sm ml-auto font-mono text-text-muted">
                git worktree add -b <span className="text-accent">{sanitizedName}</span> &hellip;{' '}
                <span className="text-text-muted">{baseBranch}</span>
              </span>
            </>
          ) : pickingBase ? (
            <>
              <span className="flex items-center gap-0.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> select base
              </span>
              <span className="flex items-center gap-0.5">
                <Kbd>↩</Kbd> confirm
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-0.5">
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd> navigate
              </span>
              <span className="flex items-center gap-0.5">
                <Kbd>↩</Kbd> create/open
              </span>
              <span className="ml-auto">type name → create new</span>
            </>
          )}
        </div>
      </Modal>
    </ModalOverlay>
  );
}

function BranchItem({
  branch,
  isConfirming,
  workspace,
  onCreateWT,
  onConfirmCreate,
  onCancelConfirm,
}: {
  branch: BranchDetail;
  isConfirming: boolean;
  workspace: Workspace;
  onCreateWT: () => void;
  onConfirmCreate: () => void;
  onCancelConfirm: () => void;
}) {
  const disabled = branch.is_head || branch.is_in_worktree;

  return (
    <div
      className={
        isConfirming ? 'my-0.5 overflow-hidden rounded-[6px] border border-accent/20' : undefined
      }
    >
      <div className={branchItemRow({ disabled, isConfirming })}>
        <svg
          width="11"
          height="11"
          viewBox="0 0 16 16"
          fill="none"
          stroke={branch.is_head ? 'var(--accent)' : 'var(--text-muted)'}
          strokeWidth="2"
        >
          <circle cx="8" cy="8" r="3" />
        </svg>
        <span
          className={`ui-base text-text-primary ${branch.is_head ? 'font-medium' : 'font-normal'}`}
        >
          {branch.name}
        </span>
        {branch.is_head && <Badge color="accent">HEAD</Badge>}
        {branch.is_local && !branch.is_head && <Badge color="warning">local</Badge>}
        {!branch.is_local && <Badge>origin</Badge>}
        {branch.is_in_worktree && <Badge color="error">in worktree</Badge>}
        {disabled ? (
          <span className="ui-sm ml-auto text-text-muted">
            {branch.is_head ? 'checked out' : 'in use'}
          </span>
        ) : !isConfirming ? (
          <Button variant="accent" size="sm" className="ml-auto" onPress={onCreateWT}>
            Create WT
          </Button>
        ) : null}
      </div>
      {isConfirming && (
        <div className="border-t border-accent/10 bg-accent/[0.03] px-2.5 py-2">
          <div className="ui-sm mb-1.5 text-text-muted">
            Create worktree for <strong className="text-text-primary">{branch.name}</strong>
          </div>
          <div className="ui-sm mb-2 flex items-center gap-1.5 rounded bg-bg-primary px-2 py-1 font-mono text-text-muted">
            git worktree add ~/.superagent/worktrees/{workspace.name}-{branch.name}{' '}
            {branch.is_local ? branch.name : `origin/${branch.name}`}
          </div>
          <div className="flex justify-end gap-1.5">
            <Button variant="secondary" size="sm" onPress={onCancelConfirm}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onPress={onConfirmCreate}>
              Create
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorktreeItem({
  worktree,
  onOpen,
  showPath,
  isInSidebar,
}: {
  worktree: { name: string; path: string };
  onOpen: () => void;
  showPath?: boolean;
  isInSidebar?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.75 rounded-[5px] px-2 py-1.5 hover:bg-accent/[0.06] ${isInSidebar ? 'opacity-50' : ''}`}
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 16 16"
        fill="none"
        stroke="var(--text-muted)"
        strokeWidth="1.5"
      >
        <rect x="3" y="3" width="10" height="10" rx="2" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="ui-base text-text-primary">{worktree.name}</div>
        {showPath && (
          <div className="ui-xs overflow-hidden text-ellipsis whitespace-nowrap text-text-muted">
            {worktree.path}
          </div>
        )}
      </div>
      {isInSidebar ? (
        <span className="ui-sm ml-auto text-text-muted">opened</span>
      ) : (
        <Button
          size="sm"
          className="ml-auto bg-(--agent-idle)/[0.08] text-(--agent-idle) hover:bg-(--agent-idle)/[0.14]"
          onPress={onOpen}
        >
          Open
        </Button>
      )}
    </div>
  );
}
