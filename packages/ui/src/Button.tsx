import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

import { tv, type VariantProps } from 'tailwind-variants';

const button = tv({
  base: 'inline-flex appearance-none items-center justify-center gap-1.5 rounded-md font-medium outline-none transition-[color,background-color,opacity,box-shadow] disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-focus',
  variants: {
    variant: {
      primary: 'bg-accent text-white hover:opacity-90 pressed:opacity-75',
      secondary: 'bg-surface text-fg-muted hover:text-fg pressed:opacity-80',
      ghost:
        'bg-transparent text-fg-muted hover:bg-surface hover:text-fg pressed:bg-raised pressed:text-fg',
      destructive: 'bg-danger text-white hover:opacity-90 pressed:opacity-75',
      'destructive-ghost':
        'bg-transparent text-danger/80 hover:bg-danger/10 pressed:bg-danger/[0.15]',
      link: 'bg-transparent text-fg-muted hover:text-fg pressed:opacity-70',
      accent: 'bg-accent/[0.08] text-accent hover:bg-accent/[0.12] pressed:bg-accent/[0.18]',
    },
    size: {
      sm: 'rounded-md px-2 py-1.25 text-sm',
      md: 'h-8 px-4 text-base',
      lg: 'h-9 px-3 text-lg',
    },
    iconOnly: { true: 'h-7 w-7 p-0' },
  },
  compoundVariants: [
    { variant: 'link', class: 'h-auto rounded-none p-0' },
    { iconOnly: true, class: 'rounded-md' },
    { iconOnly: true, size: 'sm', class: 'h-6 w-6' },
  ],
  defaultVariants: { variant: 'secondary', size: 'md' },
});

export type ButtonVariants = VariantProps<typeof button>;

export interface ButtonProps extends Omit<AriaButtonProps, 'className'>, ButtonVariants {
  className?: string;
}

export function Button({ variant, size, iconOnly, className, ...props }: ButtonProps) {
  return (
    <AriaButton className={button({ variant, size, iconOnly, class: className })} {...props} />
  );
}
