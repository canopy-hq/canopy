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
      className="flex h-12 flex-shrink-0 items-center border-b border-border bg-bg-primary"
      style={{ paddingLeft: '78px' }}
    >
      {/* Left zone — sidebar toggle */}
      <div data-tauri-drag-region className="flex h-full items-center px-1">
        <button
          onClick={toggleSidebar}
          aria-label="Toggle sidebar"
          className="group relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          <SidebarToggleIcon />
          <span className="pointer-events-none absolute left-full ml-2 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-bg-tertiary px-2 py-1 text-xs leading-none text-text-primary opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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

      {/* Right zone — reserved for future actions */}
      <div data-tauri-drag-region className="h-full px-3" />
    </header>
  );
}
