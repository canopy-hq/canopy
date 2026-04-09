import { Badge } from '@superagent/ui';

const branch = import.meta.env.VITE_GIT_BRANCH ?? 'unknown';

export function DevBranchBadge() {
  if (!import.meta.env.DEV) return null;
  return (
    <Badge size="lg" color="success" className="font-mono select-none">
      {branch}
    </Badge>
  );
}
