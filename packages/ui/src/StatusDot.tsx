import type { CSSProperties } from 'react';

import { tv, type VariantProps } from 'tailwind-variants';

const statusDot = tv({
  base: 'inline-block shrink-0 rounded-full size-(--dot-size)',
  variants: {
    status: {
      idle: 'bg-(--agent-idle)',
      working: 'bg-(--agent-running) animate-[pulse-slow_2s_ease-in-out_infinite]',
      permission: 'bg-(--agent-waiting) animate-[pulse-slow_2s_ease-in-out_infinite]',
      review: 'bg-green-500',
    },
  },
});

export type DotStatus = NonNullable<VariantProps<typeof statusDot>['status']>;

export function StatusDot({ status, size = 8 }: { status: DotStatus; size?: number }) {
  return (
    <span
      className={statusDot({ status })}
      style={{ '--dot-size': `${size}px` } as CSSProperties}
      role="img"
      aria-label={`Agent ${status}`}
    />
  );
}
