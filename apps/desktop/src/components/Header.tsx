import { toggleSidebar } from '../lib/workspace-actions';
import { Button, Tooltip } from './ui';

interface HeaderProps {
  onSessionsClick?: () => void;
}

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

export function Header({ onSessionsClick }: HeaderProps = {}) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center border-b border-border bg-bg-primary pl-[78px]"
    >
      {/* Left zone — sidebar toggle */}
      <div data-tauri-drag-region className="flex h-full items-center px-1">
        <Tooltip
          label={
            <>
              Toggle sidebar{' '}
              <kbd className="rounded bg-bg-secondary px-1 py-0.5 text-[10px] leading-none text-text-muted">
                ⌘
              </kbd>
              <kbd className="rounded bg-bg-secondary px-1 py-0.5 text-[10px] leading-none text-text-muted">
                B
              </kbd>
            </>
          }
          placement="right"
        >
          <Button variant="ghost" iconOnly onPress={toggleSidebar} aria-label="Toggle sidebar">
            <SidebarToggleIcon />
          </Button>
        </Tooltip>
      </div>

      {/* Center zone — reserved for future search */}
      <div data-tauri-drag-region className="h-full flex-1" />

      {/* Right zone */}
      <div className="flex h-full items-center px-3">
        <Tooltip label="PTY Sessions" placement="left">
          <Button variant="ghost" iconOnly onPress={onSessionsClick} aria-label="PTY sessions">
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
              <rect x="2" y="3" width="12" height="3" rx="1" />
              <rect x="2" y="8" width="7" height="3" rx="1" />
              <circle cx="12" cy="9.5" r="2" />
              <line x1="14" y1="11.5" x2="15" y2="12.5" />
            </svg>
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
