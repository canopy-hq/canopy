import { tv, type VariantProps } from 'tailwind-variants';

export const badge = tv({
  base: 'inline-flex shrink-0 items-center font-normal leading-none whitespace-nowrap overflow-hidden text-ellipsis',
  variants: {
    color: {
      neutral: 'bg-white/[0.06] text-text-muted',
      accent: 'bg-accent/10 text-accent',
      warning: 'bg-amber-600/10 text-amber-600',
      error: 'bg-destructive/[0.08] text-destructive',
      success: 'bg-emerald-500/10 text-emerald-500',
      merged: 'bg-purple-500/10 text-purple-500',
    },
    size: {
      xs: 'rounded-sm px-1 py-px text-2xs',
      sm: 'rounded-sm px-1.5 py-0.5 text-xs',
      md: 'rounded-md px-2 py-0.5 text-sm',
      lg: 'rounded-md px-2.5 py-1 text-sm',
    },
    pill: { true: 'rounded-full' },
  },
  defaultVariants: { color: 'neutral', size: 'sm' },
});

export type BadgeVariants = VariantProps<typeof badge>;

export interface BadgeProps extends BadgeVariants {
  children: React.ReactNode;
  className?: string;
}

export function Badge({ color, size, pill, className, children }: BadgeProps) {
  return <span className={badge({ color, size, pill, class: className })}>{children}</span>;
}
