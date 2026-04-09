import { memo } from 'react';

import { StatusDot } from './StatusDot';

import type { DotStatus } from './StatusDot';

export const IconWithBadge = memo(function IconWithBadge({
  children,
  agentStatus,
}: {
  children: React.ReactNode;
  agentStatus?: DotStatus;
}) {
  return (
    <div className="relative flex w-6 shrink-0 items-center justify-center">
      {children}
      {agentStatus && agentStatus !== 'idle' && (
        <div className="absolute -top-0.5 -right-0.5 leading-[0]">
          <StatusDot status={agentStatus} size={6} />
        </div>
      )}
    </div>
  );
});
