export type DotStatus = 'running' | 'waiting' | 'idle';

const STATUS_CONFIG: Record<DotStatus, { color: string; animation: string }> = {
  running: {
    color: 'var(--agent-running)',
    animation: 'animate-[pulse-slow_2s_ease-in-out_infinite]',
  },
  waiting: {
    color: 'var(--agent-waiting)',
    animation: 'animate-[breathe_2.5s_ease-in-out_infinite]',
  },
  idle: {
    color: 'var(--agent-idle)',
    animation: '',
  },
};

export function StatusDot({ status, size = 8 }: { status: DotStatus; size?: number }) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className={`inline-block rounded-full ${config.animation}`}
      style={{
        width: size,
        height: size,
        backgroundColor: config.color,
        flexShrink: 0,
      }}
      role="img"
      aria-label={`Agent ${status}`}
    />
  );
}
