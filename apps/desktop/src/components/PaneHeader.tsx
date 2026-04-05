import { useCallback, useState } from 'react';

import { tv } from 'tailwind-variants';

import { StatusDot } from './StatusDot';
import { Tooltip } from './ui';

import type { DotStatus } from './StatusDot';

const wrapper = tv({
  base: 'absolute top-0 right-0 z-10 rounded-bl-[6px] px-4 py-1 font-mono text-md leading-none flex items-center gap-1 backdrop-blur-[4px] cursor-pointer select-none',
  variants: { focused: { true: 'text-text-primary', false: 'text-text-muted' } },
});

function formatCwd(cwd: string): { display: string; truncated: boolean } {
  const segments = cwd.split('/').filter(Boolean);
  if (segments.length === 0) return { display: '~', truncated: false };
  if (segments.length <= 4) return { display: segments.join('/'), truncated: false };
  const head = segments.slice(0, 2).join('/');
  const tail = segments.slice(-2).join('/');
  return { display: `${head}/…/${tail}`, truncated: true };
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
  const [copied, setCopied] = useState(false);

  const { display, truncated } = formatCwd(cwd);

  const handleCopy = useCallback(() => {
    if (!cwd) return;
    void navigator.clipboard.writeText(cwd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 600);
    });
  }, [cwd]);

  const showAgent = agentStatus && agentStatus !== 'idle';

  const content = (
    <div
      className={wrapper({ focused: isFocused })}
      style={{ background: 'color-mix(in srgb, var(--bg-tertiary) 85%, transparent)' }}
      onClick={handleCopy}
    >
      {showAgent && <StatusDot status={agentStatus} size={8} />}
      {showAgent && agentName && (
        <>
          <span className="text-sm text-text-primary">{agentName}</span>
          <span className="text-sm text-text-muted opacity-40">&middot;</span>
        </>
      )}
      <span className={`transition-opacity duration-75 ${copied ? 'opacity-30' : ''}`}>
        {display}
      </span>
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
