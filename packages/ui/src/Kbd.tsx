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
  default:
    'inline-flex items-center rounded bg-raised px-1 py-0.5 text-sm leading-none text-fg-muted',
  menu: 'inline-flex items-center rounded border border-edge/60 bg-base px-1 py-0.5 text-[10px] leading-none text-fg-muted',
} as const;

export type KbdVariant = keyof typeof VARIANT_CLASS;

export function Kbd({
  children,
  variant = 'default',
  className,
}: {
  children: ReactNode;
  variant?: KbdVariant;
  className?: string;
}) {
  const cls = className ? `${VARIANT_CLASS[variant]} ${className}` : VARIANT_CLASS[variant];

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
