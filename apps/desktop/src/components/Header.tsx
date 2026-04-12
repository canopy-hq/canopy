import { useMemo, useCallback } from 'react';
import { Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';

import { Button, Kbd, SectionLabel, Tooltip } from '@canopy/ui';
import { useNavigate } from '@tanstack/react-router';
import {
  ChevronLeft,
  ChevronRight,
  GitBranch,
  History,
  PanelLeft,
  Search,
  Settings,
  Shell,
} from 'lucide-react';

import { useProjects, useUiState } from '../hooks/useCollections';
import {
  goBack,
  goForward,
  navigateToSettings,
  selectProjectItem,
  toggleSidebar,
} from '../lib/project-actions';
import { DevBranchBadge } from './DevBranchBadge';
import { GitHubStatus } from './GitHubStatus';
import { OpenInEditorButton } from './OpenInEditorButton';

import type { NavEntry } from '@canopy/db';

const RECENTLY_VIEWED_MAX = 15;

interface HeaderProps {
  onSessionsClick?: () => void;
  onSearchClick?: () => void;
  recentlyViewedOpen?: boolean;
  onRecentlyViewedChange?: (open: boolean) => void;
}

export function Header({
  onSessionsClick,
  onSearchClick,
  recentlyViewedOpen,
  onRecentlyViewedChange,
}: HeaderProps = {}) {
  const projects = useProjects();
  const { navHistory, navIndex } = useUiState();
  const navigate = useNavigate();

  const canGoBack = navIndex > 0;
  const canGoForward = navIndex < navHistory.length - 1;

  const recentEntries = useMemo<NavEntry[]>(() => {
    const seen = new Set<string>();
    const result: NavEntry[] = [];
    for (let i = navHistory.length - 1; i >= 0; i--) {
      const entry = navHistory[i]!;
      const key =
        entry.type === 'settings'
          ? `settings:${entry.section ?? ''}`
          : `${entry.contextId ?? ''}:${entry.tabId ?? ''}`;
      if (key && !seen.has(key)) {
        seen.add(key);
        result.push(entry);
        if (result.length >= RECENTLY_VIEWED_MAX) break;
      }
    }
    return result;
  }, [navHistory]);

  const handleRecentSelect = useCallback(
    (key: string) => {
      const index = parseInt(key, 10);
      const entry = recentEntries[index];
      if (!entry) return;
      onRecentlyViewedChange?.(false);
      if (entry.type === 'settings') {
        navigateToSettings(entry.section ?? 'appearance', navigate);
      } else if (entry.contextId) {
        selectProjectItem(entry.contextId, navigate, entry.tabId);
      }
    },
    [recentEntries, navigate, onRecentlyViewedChange],
  );

  const projectColorMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of projects) map.set(p.id, p.color ?? null);
    return map;
  }, [projects]);

  return (
    <header
      data-tauri-drag-region
      className="relative flex h-12 shrink-0 items-center border-b border-edge/20 bg-raised pl-[78px]"
    >
      {/* Left zone — sidebar toggle + nav + recently-viewed + PTY sessions */}
      <div data-tauri-drag-region className="flex h-full items-center px-1">
        {projects.length > 0 && (
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
        )}

        {/* Back / Forward buttons */}
        <Tooltip
          label={
            <>
              Go back <Kbd>⌘[</Kbd>
            </>
          }
          placement="right"
        >
          <Button
            variant="ghost"
            iconOnly
            isDisabled={!canGoBack}
            onPress={() => goBack(navigate)}
            aria-label="Go back"
          >
            <ChevronLeft size={16} />
          </Button>
        </Tooltip>
        <Tooltip
          label={
            <>
              Go forward <Kbd>⌘]</Kbd>
            </>
          }
          placement="right"
        >
          <Button
            variant="ghost"
            iconOnly
            isDisabled={!canGoForward}
            onPress={() => goForward(navigate)}
            aria-label="Go forward"
          >
            <ChevronRight size={16} />
          </Button>
        </Tooltip>

        {/* Recently Viewed dropdown */}
        <MenuTrigger isOpen={recentlyViewedOpen} onOpenChange={onRecentlyViewedChange}>
          <Tooltip
            label={
              <>
                Recently Viewed <Kbd>⌘⇧H</Kbd>
              </>
            }
            placement="right"
          >
            <Button variant="ghost" iconOnly aria-label="Recently Viewed">
              <History size={16} />
            </Button>
          </Tooltip>
          <Popover
            placement="bottom start"
            offset={4}
            className="w-64 overflow-hidden rounded-lg border border-edge/60 bg-raised shadow-xl outline-none"
          >
            <div className="px-3 pt-2 pb-1">
              <SectionLabel>Recently Viewed</SectionLabel>
            </div>
            {recentEntries.length === 0 ? (
              <div className="px-3 py-3 text-xs text-fg-faint">No history yet.</div>
            ) : (
              <Menu
                className="max-h-80 overflow-y-auto p-1 outline-none"
                onAction={(key) => handleRecentSelect(String(key))}
              >
                {recentEntries.map((entry, i) => {
                  const projectColor = entry.projectId
                    ? (projectColorMap.get(entry.projectId) ?? null)
                    : null;

                  let primaryLabel = entry.label;
                  let secondaryLabel = '';
                  if (entry.type === 'settings') {
                    if (entry.section) {
                      secondaryLabel =
                        entry.section.charAt(0).toUpperCase() + entry.section.slice(1);
                    }
                  } else if (entry.contextId && entry.projectId) {
                    const projectName = entry.projectName ?? '';
                    primaryLabel = entry.tabId
                      ? `${projectName} · ${entry.label}`
                      : projectName || entry.label;
                    const pid = entry.projectId;
                    let contextName = '';
                    if (entry.contextId.includes(`${pid}-branch-`)) {
                      contextName = entry.contextId.split(`${pid}-branch-`)[1] ?? '';
                    } else if (entry.contextId.includes(`${pid}-wt-`)) {
                      const wtName = entry.contextId.split(`${pid}-wt-`)[1];
                      const proj = projects.find((p) => p.id === pid);
                      const wt = proj?.worktrees.find((w) => w.name === wtName);
                      contextName = wt?.label || wt?.branch || wtName || '';
                    }
                    if (contextName && contextName !== primaryLabel) {
                      secondaryLabel = contextName;
                    }
                  } else {
                    primaryLabel = entry.projectName ?? entry.label;
                  }

                  return (
                    <MenuItem
                      key={`${entry.contextId ?? 'settings'}-${entry.tabId ?? ''}`}
                      id={String(i)}
                      className="flex cursor-default items-start gap-1.5 rounded px-2 py-1 outline-none data-[focused]:bg-surface"
                    >
                      {entry.type === 'settings' ? (
                        <Settings size={10} className="mt-0.5 shrink-0 text-fg-faint" />
                      ) : (
                        <GitBranch
                          size={10}
                          className="mt-0.5 shrink-0 text-fg-faint"
                          style={projectColor ? { color: projectColor } : undefined}
                        />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-xs text-fg">{primaryLabel}</span>
                        <span className="truncate font-mono text-[10px] text-fg-faint">
                          {secondaryLabel || '\u00A0'}
                        </span>
                      </div>
                    </MenuItem>
                  );
                })}
              </Menu>
            )}
          </Popover>
        </MenuTrigger>

        <div className="mx-1 h-4 w-px shrink-0 bg-edge/40" />

        <Tooltip label="PTY Sessions" placement="right">
          <Button variant="ghost" iconOnly onPress={onSessionsClick} aria-label="PTY sessions">
            <Shell size={16} />
          </Button>
        </Tooltip>
      </div>

      {/* Center zone — spacer to push right zone right */}
      <div data-tauri-drag-region className="flex-1" />

      {/* Search — absolutely centered in the full header width */}
      <div
        data-tauri-drag-region
        className="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <button
          type="button"
          onClick={onSearchClick}
          className="pointer-events-auto flex w-full max-w-[320px] cursor-pointer items-center gap-2 rounded-md border border-edge/30 bg-base/40 px-3 py-1.5 text-base text-fg-faint transition-colors hover:border-edge/50 hover:bg-base/70 hover:text-fg-muted"
        >
          <Search size={12} className="shrink-0" />
          <span className="flex-1 text-left leading-none">Search or run a command…</span>
          <Kbd>⌘K</Kbd>
        </button>
      </div>

      {/* Right zone */}
      <div className="flex h-full items-center gap-2 px-3">
        <DevBranchBadge />
        <OpenInEditorButton />
        <GitHubStatus />
      </div>
    </header>
  );
}
