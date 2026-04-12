import type { CSSProperties } from 'react';

import { tv, type VariantProps } from 'tailwind-variants';

const statusDot = tv({
  base: 'inline-block shrink-0 rounded-full size-(--dot-size)',
  variants: {
    status: {
      // Legacy states — aliases for backward compat during transition
      running: 'bg-(--agent-running) animate-[pulse-slow_2s_ease-in-out_infinite]',
      waiting: 'bg-(--agent-waiting) animate-[breathe_2.5s_ease-in-out_infinite]',
      idle: 'bg-(--agent-idle)',
      // Hook-based states
      working: 'bg-(--agent-running) animate-[pulse-slow_2s_ease-in-out_infinite]',
      permission: 'bg-(--agent-waiting) animate-[ping_1.5s_cubic-bezier(0,0,0.2,1)_infinite]',
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
