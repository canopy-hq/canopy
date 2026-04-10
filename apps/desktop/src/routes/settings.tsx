import { useEffect, useCallback } from 'react';

import { getUiState } from '@superagent/db';
import { Button, SectionLabel } from '@superagent/ui';
import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronLeft, Palette, GitBranch } from 'lucide-react';
import { tv } from 'tailwind-variants';

import { AppearanceSection } from '../components/settings/AppearanceSection';
import { ConnectionSection } from '../components/settings/ConnectionSection';

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
      true: 'bg-surface text-fg',
      false: 'text-fg-muted hover:bg-surface/50 hover:text-fg',
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
      void navigate({ to: '/projects/$projectId', params: { projectId: activeContextId } });
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
    <div className="fixed inset-0 z-50 flex bg-base">
      {/* Left sidebar */}
      <div className="flex w-[220px] flex-shrink-0 flex-col border-r border-edge/20 bg-raised">
        <div data-tauri-drag-region className="h-12 flex-shrink-0" />
        <div className="px-3 py-2">
          <Button variant="link" size="md" onPress={navigateBack} aria-label="Back to app">
            <ChevronLeft size={14} />
            Back
          </Button>
        </div>
        <div className="mb-2 border-b border-edge/20" />

        <nav className="flex-1 space-y-4 px-3 pt-3">
          {NAV.map((group) => (
            <div key={group.label}>
              <SectionLabel className="mb-1 px-2">{group.label}</SectionLabel>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <Button
                    key={item.id}
                    className={`${navItem({ active: activeSection === item.id })} justify-start`}
                    onPress={() => void navigate({ to: '/settings', search: { section: item.id } })}
                  >
                    <item.icon size={13} />
                    {item.label}
                  </Button>
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
