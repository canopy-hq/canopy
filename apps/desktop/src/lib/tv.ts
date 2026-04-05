import { createTV } from 'tailwind-variants';

/**
 * Custom tv() instance that tells tailwind-merge text-ui-* are font-size utilities,
 * not text-color utilities. Without this, twMerge removes the color class when
 * both a text-ui-* size and a text-{color} class appear together (e.g. in Button).
 */
export const tv = createTV({
  twMergeConfig: {
    extend: {
      classGroups: { 'font-size': [{ 'text-ui': ['2xs', 'xs', 'sm', 'md', 'base', 'lg'] }] },
    },
  },
});

export type { VariantProps } from 'tailwind-variants';
