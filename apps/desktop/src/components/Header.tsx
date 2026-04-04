import { toggleSidebar } from '../lib/workspace-actions';

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
        <button
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="group relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          <SidebarToggleIcon />
          <span className="pointer-events-none absolute left-full ml-2 flex items-center gap-1.5 rounded-md bg-bg-tertiary px-2 py-1 text-xs leading-none whitespace-nowrap text-text-primary opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            Toggle sidebar
            <kbd className="rounded bg-bg-secondary px-1 py-0.5 text-[10px] leading-none text-text-muted">
              ⌘
            </kbd>
            <kbd className="rounded bg-bg-secondary px-1 py-0.5 text-[10px] leading-none text-text-muted">
              B
            </kbd>
          </span>
        </button>
      </div>

      {/* Center zone — reserved for future search */}
      <div data-tauri-drag-region className="h-full flex-1" />

      {/* Right zone */}
      <div className="flex h-full items-center px-3">
        <button
          onClick={onSessionsClick}
          aria-label="PTY sessions"
          className="group relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
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
          <span className="pointer-events-none absolute right-full mr-2 flex items-center rounded-md bg-bg-tertiary px-2 py-1 text-xs leading-none whitespace-nowrap text-text-primary opacity-0 shadow-lg transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            PTY Sessions
          </span>
        </button>
      </div>
    </header>
  );
}
