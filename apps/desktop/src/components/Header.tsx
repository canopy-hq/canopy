import { PanelLeft, Search, Shell } from 'lucide-react';

import { toggleSidebar } from '../lib/project-actions';
import { DevBranchBadge } from './DevBranchBadge';
import { GitHubStatus } from './GitHubStatus';
import { Button, Kbd, Tooltip } from './ui';

interface HeaderProps {
  onSessionsClick?: () => void;
  onSearchClick?: () => void;
}

export function Header({ onSessionsClick, onSearchClick }: HeaderProps = {}) {
  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center border-b border-border/40 bg-bg-secondary pl-[78px]"
    >
      {/* Left zone — sidebar toggle + PTY sessions */}
      <div data-tauri-drag-region className="flex h-full items-center px-1">
        <Tooltip
          label={
            <>
              Toggle sidebar <Kbd>⌘B</Kbd>
            </>
          }
          placement="right"
        >
          <Button variant="ghost" iconOnly onPress={toggleSidebar} aria-label="Toggle sidebar">
            <PanelLeft size={16} />
          </Button>
        </Tooltip>
        <Tooltip label="PTY Sessions" placement="right">
          <Button variant="ghost" iconOnly onPress={onSessionsClick} aria-label="PTY sessions">
            <Shell size={16} />
          </Button>
        </Tooltip>
      </div>

      {/* Center zone — fake search field */}
      <div data-tauri-drag-region className="flex h-full flex-1 items-center justify-center px-4">
        <button
          type="button"
          onClick={onSearchClick}
          className="flex w-full max-w-[320px] cursor-pointer items-center gap-2 rounded-md border border-border/30 bg-bg-primary/40 px-3 py-1.5 text-[13px] text-text-faint transition-colors hover:border-border/50 hover:bg-bg-primary/70 hover:text-text-muted"
        >
          <Search size={12} className="shrink-0" />
          <span className="flex-1 text-left leading-none">Search or run a command…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      {/* Right zone */}
      <div className="flex h-full items-center gap-2 px-3">
        <DevBranchBadge />
        <GitHubStatus />
      </div>
    </header>
  );
}
