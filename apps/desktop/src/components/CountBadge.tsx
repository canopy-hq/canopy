import { Badge } from '@canopy/ui';

export function CountBadge({ count }: { count: number | undefined }) {
  return (
    <Badge size="sm" color="faint" className="font-mono tabular-nums">
      {count}
    </Badge>
  );
}
