import type { ReactElement, ReactNode } from 'react';
import { TooltipTrigger, Tooltip as AriaTooltip } from 'react-aria-components';

export interface TooltipProps {
  children: ReactElement;
  label: ReactNode;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({ children, label, placement = 'bottom', delay = 400 }: TooltipProps) {
  return (
    <TooltipTrigger delay={delay} closeDelay={100}>
      {children}
      <AriaTooltip
        placement={placement}
        offset={8}
        className="pointer-events-none flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2 py-1 text-xs leading-none text-text-primary shadow-lg transition-opacity duration-100 entering:opacity-0 exiting:opacity-0"
      >
        {label}
      </AriaTooltip>
    </TooltipTrigger>
  );
}
