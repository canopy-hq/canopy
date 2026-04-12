import { memo } from 'react';

function fmt(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export const DiffPill = memo(function DiffPill({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="inline-flex flex-shrink-0 gap-1 rounded-sm bg-hover px-1.5 py-0.5 font-mono text-sm font-normal whitespace-nowrap">
      {additions > 0 && <span className="text-ahead tabular-nums">+{fmt(additions)}</span>}
      {deletions > 0 && <span className="text-behind tabular-nums">&minus;{fmt(deletions)}</span>}
    </span>
  );
});
