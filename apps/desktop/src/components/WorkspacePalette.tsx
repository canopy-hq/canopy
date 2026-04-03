import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Workspace } from '@superagent/db';
import { listAllBranches, listWorktrees, type BranchDetail, type WorktreeInfo } from '../lib/git';
import { createWorktree, openWorktree } from '../lib/workspace-actions';

export interface WorkspacePaletteProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: Workspace;
}

type Tab = 'all' | 'worktrees';

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
    setQuery('');
    setTab('all');
    setConfirmBranch(null);
    setPickingBase(false);
    listAllBranches(workspace.path).then(setBranches).catch(() => {});
    listWorktrees(workspace.path).then(setAllWorktrees).catch(() => {});
    const head = workspace.branches.find((b) => b.is_head);
    setBaseBranch(head?.name ?? 'main');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen, workspace]);

  const filteredBranches = branches.filter((b) =>
    b.name.toLowerCase().includes(query.toLowerCase()),
  );
  const exactMatch = branches.find(
    (b) => b.name.toLowerCase() === query.trim().toLowerCase(),
  );
  const isCreateMode = query.trim().length > 0 && !exactMatch;

  // Worktrees from disk — mark which are already in the sidebar
  const sidebarNames = new Set(workspace.worktrees.map((wt) => wt.name));
  const diskWorktrees = allWorktrees.map((wt) => ({
    ...wt,
    isInSidebar: sidebarNames.has(wt.name),
  }));
  const filteredWorktrees = diskWorktrees.filter((wt) =>
    wt.name.toLowerCase().includes(query.toLowerCase()),
  );

  const handleCreateNew = useCallback(async () => {
    const name = query.trim();
    if (!name) return;
    // Worktree name (git identifier) must not contain slashes
    const wtName = name.replaceAll('/', '-');
    const wtPath = `~/.superagent/worktrees/${workspace.name}-${wtName}`;
    await createWorktree(workspace.id, wtName, wtPath, baseBranch, wtName);
    onClose();
  }, [query, workspace, baseBranch, onClose]);

  async function handleCreateFromBranch(branchName: string) {
    const wtName = branchName.replaceAll('/', '-');
    const wtPath = `~/.superagent/worktrees/${workspace.name}-${wtName}`;
    await createWorktree(workspace.id, wtName, wtPath, branchName);
    onClose();
  }

  function handleOpenWorktree(name: string, path: string) {
    openWorktree(workspace.id, name, path);
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
        handleCreateNew();
      }
    },
    [onClose, pickingBase, confirmBranch, isCreateMode, handleCreateNew],
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={handleKeyDown}
      role="presentation"
    >
      <div
        className="w-[440px] overflow-hidden"
        style={{ background: '#161622', border: '1px solid #2a2a3e', borderRadius: '10px', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}
      >
        {/* Search bar */}
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #1e1e2e' }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.5">
            <circle cx="7" cy="7" r="4"/><path d="M10 10l3 3"/>
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setConfirmBranch(null); }}
            placeholder="Search or create new branch..."
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)]"
            style={{ fontSize: '14px' }}
          />
          <span style={{ fontSize: '10px', color: '#444', background: '#1a1a2e', padding: '2px 6px', borderRadius: '4px' }}>ESC</span>
        </div>

        {/* Create card */}
        {isCreateMode && !pickingBase && (
          <div className="mx-2 mt-2 p-3 rounded-lg" style={{ background: 'rgba(59,130,246,0.05)', border: '1px solid rgba(59,130,246,0.15)' }}>
            <div className="flex items-center gap-2 mb-2">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="1.5"><path d="M8 3v10M3 8h10"/></svg>
              <span style={{ fontWeight: 500, color: 'var(--accent)', flex: 1, fontSize: '13px' }}>Create &ldquo;{query.trim()}&rdquo;</span>
              <span style={{ fontSize: '10px', color: '#555', fontFamily: 'monospace' }}>&#x2318;&#x21A9;</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span style={{ fontSize: '11px', color: '#555' }}>from</span>
              <button
                onClick={() => setPickingBase(true)}
                className="flex items-center gap-1 px-2 py-0.5 cursor-pointer"
                style={{ background: '#1a1a2e', border: '1px solid #2a2a3e', borderRadius: '5px', fontSize: '11px' }}
              >
                <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="var(--accent)" strokeWidth="2"><circle cx="8" cy="8" r="3"/></svg>
                <span style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{baseBranch}</span>
                <svg width="8" height="8" viewBox="0 0 16 16" fill="#555"><path d="M4 6l4 4 4-4z"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-0.5 mx-2 mt-2 p-0.5 rounded-[6px]" style={{ background: '#0e0e16' }}>
          <button
            onClick={() => setTab('all')}
            className="flex-1 flex items-center justify-center gap-1 py-[5px] px-2 rounded cursor-pointer border-none"
            style={{ fontSize: '12px', background: tab === 'all' ? '#1a1a2e' : 'transparent', color: tab === 'all' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            All <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.06)', padding: '0 5px', borderRadius: '8px' }}>{branches.length}</span>
          </button>
          <button
            onClick={() => setTab('worktrees')}
            className="flex-1 flex items-center justify-center gap-1 py-[5px] px-2 rounded cursor-pointer border-none"
            style={{ fontSize: '12px', background: tab === 'worktrees' ? '#1a1a2e' : 'transparent', color: tab === 'worktrees' ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            Worktrees <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.06)', padding: '0 5px', borderRadius: '8px' }}>{diskWorktrees.length}</span>
          </button>
        </div>

        {/* Content */}
        <div className="px-2 pb-2" style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {tab === 'all' && !pickingBase && (
            <>
              <div style={{ fontSize: '10px', color: '#444', padding: '6px 8px 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Branches</div>
              {filteredBranches.length === 0 && (
                <div style={{ padding: '12px 8px', textAlign: 'center', color: '#333', fontSize: '12px' }}>
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
                  onConfirmCreate={() => handleCreateFromBranch(b.name)}
                  onCancelConfirm={() => setConfirmBranch(null)}
                />
              ))}
              <div style={{ fontSize: '10px', color: '#444', padding: '6px 8px 4px', textTransform: 'uppercase', letterSpacing: '0.5px', borderTop: '1px solid #1e1e2e', marginTop: '4px' }}>Worktrees</div>
              {filteredWorktrees.length === 0 && (
                <div style={{ padding: '12px 8px', textAlign: 'center', color: '#333', fontSize: '12px' }}>No worktrees</div>
              )}
              {filteredWorktrees.map((wt) => (
                <WorktreeItem key={wt.name} worktree={wt} onOpen={() => handleOpenWorktree(wt.name, wt.path)} isInSidebar={wt.isInSidebar} />
              ))}
            </>
          )}

          {tab === 'worktrees' && (
            <>
              {filteredWorktrees.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>No worktrees</div>
                  <div style={{ fontSize: '12px', color: '#444' }}>Create one from the All tab</div>
                </div>
              )}
              {filteredWorktrees.map((wt) => (
                <WorktreeItem key={wt.name} worktree={wt} onOpen={() => handleOpenWorktree(wt.name, wt.path)} showPath isInSidebar={wt.isInSidebar} />
              ))}
              {filteredWorktrees.length > 0 && (
                <div style={{ padding: '8px', textAlign: 'center', color: '#333', fontSize: '12px', borderTop: '1px solid #1e1e2e', marginTop: '4px' }}>
                  Worktrees already on disk. Click Open to add to sidebar.
                </div>
              )}
            </>
          )}

          {pickingBase && (
            <>
              <div style={{ fontSize: '10px', color: '#444', padding: '6px 8px 4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Select base branch</div>
              {branches.filter((b) => !b.is_in_worktree).map((b) => (
                <div
                  key={b.name}
                  className="flex items-center gap-[7px] py-[6px] px-2 rounded-[5px] cursor-pointer hover:bg-[rgba(59,130,246,0.06)]"
                  style={b.name === baseBranch ? { background: 'rgba(59,130,246,0.06)' } : undefined}
                  onClick={() => { setBaseBranch(b.name); setPickingBase(false); }}
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke={b.name === baseBranch ? 'var(--accent)' : '#555'} strokeWidth="2"><circle cx="8" cy="8" r="3"/></svg>
                  <span style={{ fontSize: '13px', fontWeight: b.name === baseBranch ? 500 : 400, color: 'var(--text-primary)' }}>{b.name}</span>
                  {b.is_head && <span style={{ fontSize: '9px', color: 'var(--accent)', background: 'rgba(59,130,246,0.1)', padding: '1px 5px', borderRadius: '3px' }}>HEAD</span>}
                  {b.name === baseBranch && (
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="var(--accent)" style={{ marginLeft: 'auto' }}><path d="M6 10.8l-2.4-2.4L2 10l4 4 8-8-1.6-1.6z"/></svg>
                  )}
                </div>
              ))}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-4 py-2" style={{ borderTop: '1px solid #1e1e2e', fontSize: '11px', color: '#444' }}>
          {isCreateMode ? (
            <>
              <span>&#x2318;&#x21A9; create worktree</span>
              <span style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: '11px', color: '#555' }}>
                git worktree add -b <span style={{ color: 'var(--accent)' }}>{query.trim()}</span> &hellip; <span style={{ color: 'var(--text-muted)' }}>{baseBranch}</span>
              </span>
            </>
          ) : pickingBase ? (
            <>
              <span>&#x2191;&#x2193; select base</span>
              <span>&#x21A9; confirm</span>
            </>
          ) : (
            <>
              <span>&#x2191;&#x2193; navigate</span>
              <span>&#x21A9; create/open</span>
              <span style={{ marginLeft: 'auto' }}>type name &#x2192; create new</span>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
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
    <div style={isConfirming ? { border: '1px solid rgba(59,130,246,0.2)', borderRadius: '6px', overflow: 'hidden', margin: '2px 0' } : undefined}>
      <div
        className="flex items-center gap-[7px] py-[6px] px-2 rounded-[5px]"
        style={{
          opacity: disabled ? 0.5 : 1,
          cursor: disabled ? 'default' : 'pointer',
          background: isConfirming ? 'rgba(59,130,246,0.08)' : undefined,
        }}
      >
        <svg width="11" height="11" viewBox="0 0 16 16" fill="none"
          stroke={branch.is_head ? 'var(--accent)' : '#555'} strokeWidth="2">
          <circle cx="8" cy="8" r="3"/>
        </svg>
        <span style={{ fontSize: '13px', fontWeight: branch.is_head ? 500 : 400, color: 'var(--text-primary)' }}>{branch.name}</span>
        {branch.is_head && <span style={{ fontSize: '9px', color: 'var(--accent)', background: 'rgba(59,130,246,0.1)', padding: '1px 5px', borderRadius: '3px' }}>HEAD</span>}
        {branch.is_local && !branch.is_head && <span style={{ fontSize: '9px', color: '#d97706', background: 'rgba(217,119,6,0.1)', padding: '1px 5px', borderRadius: '3px' }}>local</span>}
        {!branch.is_local && <span style={{ fontSize: '9px', color: '#555', background: 'rgba(255,255,255,0.04)', padding: '1px 5px', borderRadius: '3px' }}>origin</span>}
        {branch.is_in_worktree && <span style={{ fontSize: '9px', color: '#ef4444', background: 'rgba(239,68,68,0.08)', padding: '1px 5px', borderRadius: '3px' }}>in worktree</span>}
        {disabled ? (
          <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#444' }}>{branch.is_head ? 'checked out' : 'in use'}</span>
        ) : !isConfirming ? (
          <button
            onClick={(e) => { e.stopPropagation(); onCreateWT(); }}
            style={{ marginLeft: 'auto', fontSize: '11px', color: 'var(--accent)', background: 'rgba(59,130,246,0.08)', padding: '2px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
          >
            Create WT
          </button>
        ) : null}
      </div>
      {isConfirming && (
        <div className="px-2.5 py-2" style={{ background: 'rgba(59,130,246,0.03)', borderTop: '1px solid rgba(59,130,246,0.1)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '6px' }}>
            Create worktree for <strong style={{ color: 'var(--text-primary)' }}>{branch.name}</strong>
          </div>
          <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded" style={{ background: '#0e0e16', fontFamily: 'monospace', fontSize: '11px', color: '#555' }}>
            git worktree add ~/.superagent/worktrees/{workspace.name}-{branch.name} {branch.is_local ? branch.name : `origin/${branch.name}`}
          </div>
          <div className="flex gap-1.5 justify-end">
            <button onClick={onCancelConfirm} style={{ padding: '4px 10px', borderRadius: '4px', border: '1px solid #2a2a3e', fontSize: '11px', color: 'var(--text-muted)', cursor: 'pointer', background: 'transparent' }}>Cancel</button>
            <button onClick={onConfirmCreate} style={{ padding: '4px 10px', borderRadius: '5px', border: 'none', fontSize: '11px', fontWeight: 500, cursor: 'pointer', background: 'var(--accent)', color: 'white' }}>Create</button>
          </div>
        </div>
      )}
    </div>
  );
}

function WorktreeItem({ worktree, onOpen, showPath, isInSidebar }: { worktree: { name: string; path: string }; onOpen: () => void; showPath?: boolean; isInSidebar?: boolean }) {
  return (
    <div
      className="flex items-center gap-[7px] py-[6px] px-2 rounded-[5px] hover:bg-[rgba(59,130,246,0.06)]"
      style={{ opacity: isInSidebar ? 0.5 : 1, cursor: isInSidebar ? 'default' : 'pointer' }}
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#555" strokeWidth="1.5">
        <rect x="3" y="3" width="10" height="10" rx="2"/>
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '13px', color: 'var(--text-primary)' }}>{worktree.name}</div>
        {showPath && (
          <div style={{ fontSize: '10px', color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{worktree.path}</div>
        )}
      </div>
      {isInSidebar ? (
        <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#444' }}>opened</span>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          style={{ marginLeft: 'auto', fontSize: '11px', color: '#22c55e', background: 'rgba(34,197,94,0.08)', padding: '2px 8px', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
        >
          Open
        </button>
      )}
    </div>
  );
}
