import { useCallback } from 'react';

import { tv } from 'tailwind-variants';

import { StatusDot, Tooltip } from './ui';

import type { DotStatus } from './ui';

const wrapper = tv({
  base: 'absolute top-0 right-0 z-10 rounded-bl-[6px] px-4 py-1 font-mono text-md leading-none flex items-center gap-1 backdrop-blur-[4px] cursor-pointer select-none',
  variants: { focused: { true: 'text-text-primary', false: 'text-text-muted' } },
});

function isCwdTruncated(cwd: string): boolean {
  return cwd.split('/').filter(Boolean).length > 4;
}

export function PaneHeader({
  cwd,
  isFocused,
  agentStatus,
  agentName,
}: {
  cwd: string;
  isFocused: boolean;
  agentStatus?: DotStatus;
  agentName?: string;
}) {
  const truncated = isCwdTruncated(cwd);

  const handleCopy = useCallback(() => {
    if (!cwd) return;
    void navigator.clipboard.writeText(cwd);
  }, [cwd]);

  const showAgent = agentStatus && agentStatus !== 'idle';

  if (!showAgent) return null;

  const content = (
    <div
      className={wrapper({ focused: isFocused, class: 'bg-bg-tertiary/85' })}
      onClick={handleCopy}
    >
      <StatusDot status={agentStatus} size={8} />
      {agentName && <span className="text-sm text-text-primary">{agentName}</span>}
    </div>
  );

  if (truncated) {
    return (
      <Tooltip label={cwd} placement="bottom">
        {content}
      </Tooltip>
    );
  }

  return content;
}
