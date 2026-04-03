import { Button, Tooltip, TooltipTrigger } from 'react-aria-components';

import { toggleSidebar } from '../lib/workspace-actions';

function SidebarToggleIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="12" height="12" rx="2" />
      <line x1="6" y1="2" x2="6" y2="14" />
    </svg>
  );
}

export function Header() {
  return (
    <header
      data-tauri-drag-region
      className="flex h-10 flex-shrink-0 items-center border-b border-border bg-bg-primary"
      style={{ paddingLeft: '70px' }}
    >
      {/* Left zone — sidebar toggle */}
      <div className="flex items-center px-1">
        <TooltipTrigger delay={600}>
          <Button
            onPress={toggleSidebar}
            aria-label="Toggle sidebar"
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted hover:bg-bg-tertiary hover:text-text-primary"
          >
            <SidebarToggleIcon />
          </Button>
          <Tooltip
            placement="right"
            className="rounded-md bg-bg-tertiary px-2 py-1 text-xs text-text-primary shadow-lg"
          >
            Toggle sidebar
            <kbd className="ml-1.5 rounded bg-bg-secondary px-1 py-0.5 text-[10px] text-text-muted">
              ⌘B
            </kbd>
          </Tooltip>
        </TooltipTrigger>
      </div>

      {/* Center zone — reserved for future search */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Right zone — reserved for future actions */}
      <div className="px-3" />
    </header>
  );
}
