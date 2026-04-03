import { tv, type VariantProps } from 'tailwind-variants';

const statusDot = tv({
  base: 'inline-block shrink-0 rounded-full',
  variants: {
    status: {
      running: 'bg-(--agent-running) animate-[pulse-slow_2s_ease-in-out_infinite]',
      waiting: 'bg-(--agent-waiting) animate-[breathe_2.5s_ease-in-out_infinite]',
      idle: 'bg-(--agent-idle)',
    },
  },
});

export type DotStatus = NonNullable<VariantProps<typeof statusDot>['status']>;

export function StatusDot({ status, size = 8 }: { status: DotStatus; size?: number }) {
  return (
    <span
      className={statusDot({ status })}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Agent ${status}`}
    />
  );
}
