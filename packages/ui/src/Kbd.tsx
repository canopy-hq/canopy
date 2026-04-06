import type { ReactNode } from 'react';

const MODIFIERS = new Set(['⌘', '⌥', '⇧', '⌃']);

function splitKeys(str: string): string[] {
  const keys: string[] = [];
  let rest = '';
  for (const char of str) {
    if (MODIFIERS.has(char)) {
      if (rest) {
        keys.push(rest);
        rest = '';
      }
      keys.push(char);
    } else {
      rest += char;
    }
  }
  if (rest) keys.push(rest);
  return keys;
}

const VARIANT_CLASS = {
  default: 'rounded bg-bg-secondary px-1 py-0.5 text-xs leading-none text-text-muted',
  menu: 'rounded border border-border/60 bg-bg-primary px-1 py-0.5 text-[10px] leading-none text-text-muted',
} as const;

export type KbdVariant = keyof typeof VARIANT_CLASS;

export function Kbd({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: KbdVariant;
}) {
  const cls = VARIANT_CLASS[variant];

  if (typeof children === 'string') {
    const keys = splitKeys(children);
    return (
      <div className="inline-flex items-center gap-1">
        {keys.map((key, i) => (
          <kbd key={i} className={cls}>
            {key}
          </kbd>
        ))}
      </div>
    );
  }

  return <kbd className={cls}>{children}</kbd>;
}
