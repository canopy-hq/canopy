import {
  Tabs,
  TabList as RACTabList,
  Tab as RACTab,
  TabPanel,
  type TabsProps,
  type TabListProps,
  type TabProps,
  type TabPanelProps,
} from 'react-aria-components';

export { Tabs, TabPanel };
export type { TabsProps, TabPanelProps };

export function TabList<T extends object>({
  className,
  border = true,
  ...props
}: Omit<TabListProps<T>, 'className'> & { className?: string; border?: boolean }) {
  return (
    <RACTabList
      className={['flex items-center gap-1', border && 'border-b border-edge/50', className]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}

export function Tab({ className, ...props }: Omit<TabProps, 'className'> & { className?: string }) {
  return (
    <RACTab
      className={[
        'cursor-pointer rounded px-2 py-0.5 font-mono text-sm outline-none transition-colors data-[focused]:ring-2 data-[focused]:ring-focus',
        'text-fg-muted hover:text-fg',
        'data-[selected]:bg-accent/10 data-[selected]:text-accent data-[selected]:hover:text-accent',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      {...props}
    />
  );
}

export type { TabListProps, TabProps };
