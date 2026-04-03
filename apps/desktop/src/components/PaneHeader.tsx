import { tv } from 'tailwind-variants';

import { StatusDot } from './StatusDot';

import type { DotStatus } from './StatusDot';

/**
 * Floating CWD overlay for a terminal pane.
 *
 * Positioned absolute top-right, shows the last 2 path segments
 * of the current working directory. Falls back to '~' when empty.
 *
 * When an agent is running or waiting, shows a StatusDot and agent name
 * before the CWD text.
 */

const wrapper = tv({
  base: 'absolute top-0 right-0 z-10 rounded-bl-[6px] px-4 py-1 font-mono text-[12px] leading-none pointer-events-none flex items-center gap-1 backdrop-blur-[4px]',
  variants: {
    focused: {
      true: 'text-text-primary',
      false: 'text-text-muted',
    },
  },
});

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
  const displayPath = cwd ? cwd.split('/').filter(Boolean).slice(-2).join('/') : '~';

  const showAgent = agentStatus && agentStatus !== 'idle';

  return (
    <div
      className={wrapper({ focused: isFocused })}
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 85%, transparent)' }}
    >
      {showAgent && <StatusDot status={agentStatus} size={8} />}
      {showAgent && agentName && (
        <>
          <span className="text-[11px] text-text-primary">{agentName}</span>
          <span className="text-[11px] text-text-muted opacity-40">&middot;</span>
        </>
      )}
      {displayPath}
    </div>
  );
}
