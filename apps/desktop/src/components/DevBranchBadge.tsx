const branch = import.meta.env.VITE_GIT_BRANCH ?? 'unknown';

export function DevBranchBadge() {
  if (!import.meta.env.DEV) return null;
  return (
    <span className="rounded bg-git-ahead/15 px-2 py-1 font-mono ui-xs leading-none text-git-ahead select-none">
      {branch}
    </span>
  );
}
