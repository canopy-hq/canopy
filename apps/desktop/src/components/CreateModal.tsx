import { useState, useEffect, useCallback } from "react";
import { Dialog, Heading } from "react-aria-components";

import { createBranch, createWorktree } from "../lib/workspace-actions";

import type { Workspace } from "@superagent/db";

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
      className={`flex flex-1 flex-col items-center gap-1 rounded-lg p-4 ${
        selected
          ? "border-2 border-[var(--accent)] bg-[var(--bg-tertiary)]"
          : "border border-[var(--border)] bg-[var(--bg-tertiary)] hover:border-[var(--text-muted)]"
      }`}
    >
      <span style={{ color: iconColor, fontSize: "20px" }}>{icon}</span>
      <span className="text-[13px] font-semibold text-[var(--text-primary)]">{label}</span>
    </button>
  );
}

export function CreateModal({ isOpen, onClose, workspace }: CreateModalProps) {
  const [type, setType] = useState<"branch" | "worktree">("branch");
  const [name, setName] = useState("");
  const [baseBranch, setBaseBranch] = useState("");

  // Initialize baseBranch to HEAD branch on open
  useEffect(() => {
    if (isOpen) {
      const head = workspace.branches.find((b) => b.is_head);
      setBaseBranch(head?.name ?? workspace.branches[0]?.name ?? "");
      setName("");
      setType("branch");
    }
  }, [isOpen, workspace.branches]);

  // Close on Esc
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  async function handleCreate() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    try {
      if (type === "branch") {
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
      <div className="w-[480px] rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-6">
        <Dialog className="outline-none" aria-label="Create Branch or Worktree">
          <Heading slot="title" className="text-[16px] font-semibold text-[var(--text-primary)]">
            Create Branch or Worktree
          </Heading>

          {/* Type cards */}
          <div className="mt-4 flex gap-2">
            <TypeCard
              selected={type === "branch"}
              onClick={() => setType("branch")}
              icon={"\u2387"}
              iconColor="var(--branch-icon)"
              label="Branch"
            />
            <TypeCard
              selected={type === "worktree"}
              onClick={() => setType("worktree")}
              icon={"\u25C6"}
              iconColor="var(--worktree-icon)"
              label="Worktree"
            />
          </div>

          {/* Name input */}
          <label className="mt-4 block">
            <span className="text-[13px] text-[var(--text-primary)]">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="feature/my-branch"
              autoFocus
              className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 text-[13px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent)]"
            />
          </label>

          {/* Base branch select */}
          <label className="mt-4 block">
            <span className="text-[13px] text-[var(--text-primary)]">Base branch</span>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
            >
              {workspace.branches.map((b) => (
                <option key={b.name} value={b.name}>
                  {b.name}
                  {b.is_head ? " (HEAD)" : ""}
                </option>
              ))}
            </select>
          </label>

          {/* Worktree path (only when type=worktree) */}
          {type === "worktree" && (
            <div className="mt-4">
              <span className="text-[13px] text-[var(--text-primary)]">Worktree path</span>
              <div className="mt-1 text-[11px] text-[var(--text-muted)]">
                ~/.superagent/worktrees/{workspace.name}-{name || "..."}
              </div>
            </div>
          )}

          {/* Git command preview */}
          <div className="mt-3 rounded-lg bg-[var(--bg-primary)] p-3">
            <code
              className="text-[11px] text-[var(--text-muted)]"
              style={{ fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}
            >
              {type === "branch"
                ? `git branch ${name || "<name>"} ${baseBranch}`
                : `git worktree add ~/.superagent/worktrees/${workspace.name}-${name || "<name>"} -b ${name || "<name>"}`}
            </code>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={onClose}
              className="h-8 rounded-lg bg-[var(--bg-tertiary)] px-4 text-[13px] text-[var(--text-muted)]"
            >
              Discard
            </button>
            <button
              onClick={handleCreate}
              disabled={!name.trim()}
              className="h-8 rounded-lg bg-[var(--accent)] px-4 text-[13px] text-white disabled:opacity-50"
            >
              {type === "branch" ? "Create Branch" : "Create Worktree"}
            </button>
          </div>
        </Dialog>
      </div>
    </div>
  );
}
