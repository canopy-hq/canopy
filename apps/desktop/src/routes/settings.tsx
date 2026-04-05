import { useEffect, useCallback } from 'react';

import { getUiState } from '@superagent/db';
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Palette, GitBranch } from 'lucide-react';
import { tv } from 'tailwind-variants';

import { AppearanceSection } from '../components/settings/AppearanceSection';
import { ConnectionSection } from '../components/settings/ConnectionSection';
import { Button } from '../components/ui';

type SectionId = 'appearance' | 'git';

interface NavItem {
  id: SectionId;
  label: string;
  icon: typeof Palette;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  { label: 'Personal', items: [{ id: 'appearance', label: 'Appearance', icon: Palette }] },
  { label: 'Editor & Workflow', items: [{ id: 'git', label: 'Git & Worktrees', icon: GitBranch }] },
];

const SECTIONS: Record<SectionId, () => React.JSX.Element> = {
  appearance: AppearanceSection,
  git: ConnectionSection,
};

const navItem = tv({
  base: 'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-base transition-colors',
  variants: {
    active: {
      true: 'bg-bg-tertiary text-text-primary',
      false: 'text-text-muted hover:bg-bg-tertiary/50 hover:text-text-primary',
    },
  },
});

function SettingsRoute() {
  const navigate = useNavigate();
  const { section } = useSearch({ from: '/settings' });
  const activeSection: SectionId = section ?? 'appearance';

  const navigateBack = useCallback(() => {
    const { activeContextId } = getUiState();
    if (activeContextId) {
      void navigate({ to: '/workspaces/$workspaceId', params: { workspaceId: activeContextId } });
    } else {
      void navigate({ to: '/' });
    }
  }, [navigate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigateBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigateBack]);

  const ActiveComponent = SECTIONS[activeSection];

  return (
    <div className="fixed inset-0 z-50 flex bg-bg-primary">
      {/* Left sidebar */}
      <div className="flex w-[220px] flex-shrink-0 flex-col border-r border-border/40 bg-bg-secondary">
        <div data-tauri-drag-region className="h-12 flex-shrink-0" />
        <div className="px-3 py-2">
          <Button variant="link" size="md" onPress={navigateBack} aria-label="Back to app">
            <ChevronLeft size={14} />
            Back
          </Button>
        </div>
        <div className="mb-2 border-b border-border/20" />

        <nav className="flex-1 space-y-4 px-3 pt-3">
          {NAV.map((group) => (
            <div key={group.label}>
              <div className="mb-1 px-2 font-mono text-2xs font-medium tracking-widest text-text-faint uppercase">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={navItem({ active: activeSection === item.id })}
                    onClick={() => void navigate({ to: '/settings', search: { section: item.id } })}
                  >
                    <item.icon size={13} />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div data-tauri-drag-region className="h-12 flex-shrink-0" />
        <div className="max-w-lg px-8 py-6">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}

export default SettingsRoute;

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
  validateSearch: (search: Record<string, unknown>): { section?: SectionId } => ({
    section:
      typeof search.section === 'string' && search.section in SECTIONS
        ? (search.section as SectionId)
        : undefined,
  }),
});
