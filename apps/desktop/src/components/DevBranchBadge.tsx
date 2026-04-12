import { Badge } from '@canopy/ui';

const branch = import.meta.env.VITE_GIT_BRANCH ?? 'unknown';

export function DevBranchBadge() {
  if (!import.meta.env.DEV) return null;
  return (
    <Badge size="sm" color="success" className="font-mono select-none">
      {branch}
    </Badge>
  );
}
