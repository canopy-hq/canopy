import { Button as AriaButton, type ButtonProps as AriaButtonProps } from 'react-aria-components';

import { tv, type VariantProps } from 'tailwind-variants';

const button = tv({
  base: 'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium outline-none transition disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-border-focus',
  variants: {
    variant: {
      primary: 'bg-accent text-white hover:opacity-90 pressed:opacity-75',
      secondary: 'bg-bg-tertiary text-text-muted hover:text-text-primary pressed:opacity-80',
      ghost:
        'bg-transparent text-text-muted hover:bg-bg-tertiary hover:text-text-primary pressed:bg-bg-secondary pressed:text-text-primary',
      destructive: 'bg-destructive text-white hover:opacity-90 pressed:opacity-75',
      'destructive-ghost':
        'bg-transparent text-destructive/80 hover:bg-destructive/10 pressed:bg-destructive/[0.15]',
      link: 'bg-transparent text-accent hover:underline pressed:opacity-70',
      accent: 'bg-accent/[0.08] text-accent hover:bg-accent/[0.12] pressed:bg-accent/[0.18]',
    },
    size: { sm: 'rounded px-2 py-1.25 ui-sm', md: 'h-8 px-4 ui-base' },
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
