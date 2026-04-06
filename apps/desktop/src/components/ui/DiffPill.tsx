import { memo } from 'react';

export const DiffPill = memo(function DiffPill({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="inline-flex flex-shrink-0 gap-1 rounded-sm bg-white/[0.04] px-1 py-px text-2xs font-normal whitespace-nowrap">
      {additions > 0 && <span className="text-(--git-ahead) tabular-nums">+{additions}</span>}
      {deletions > 0 && (
        <span className="text-(--git-behind) tabular-nums">&minus;{deletions}</span>
      )}
    </span>
  );
});
