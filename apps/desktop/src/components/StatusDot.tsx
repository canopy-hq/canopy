export type DotStatus = 'running' | 'waiting' | 'idle';

export function StatusDot({ status, size = 8 }: { status: DotStatus; size?: number }) {
  if (status === 'idle') return null;

  return (
    <span
      className={
        status === 'running'
          ? 'inline-block rounded-full animate-[pulse-slow_2s_ease-in-out_infinite]'
          : 'inline-block rounded-full animate-[breathe_2.5s_ease-in-out_infinite]'
      }
      style={{
        width: size,
        height: size,
        backgroundColor: status === 'running' ? 'var(--agent-running)' : 'var(--agent-waiting)',
        flexShrink: 0,
      }}
      role="img"
      aria-label={`Agent ${status}`}
    />
  );
}
