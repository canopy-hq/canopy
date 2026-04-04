import { useState, useEffect, useCallback } from 'react';

import { createFileRoute, useNavigate } from '@tanstack/react-router';
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
  { label: 'Editor & Workflow', items: [{ id: 'git', label: 'Git', icon: GitBranch }] },
];

const SECTIONS: Record<SectionId, () => React.JSX.Element> = {
  appearance: AppearanceSection,
  git: ConnectionSection,
};

const navItem = tv({
  base: 'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12px] transition-colors',
  variants: {
    active: {
      true: 'bg-bg-tertiary text-text-primary',
      false: 'text-text-muted hover:bg-bg-tertiary/50 hover:text-text-primary',
    },
  },
});

function SettingsRoute() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<SectionId>('appearance');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void navigate({ to: '/' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const handleBack = useCallback(() => {
    void navigate({ to: '/' });
  }, [navigate]);

  const ActiveComponent = SECTIONS[activeSection];

  return (
    <div className="fixed inset-0 z-50 flex bg-bg-primary">
      {/* Sidebar */}
      <div className="flex w-[220px] flex-shrink-0 flex-col border-r border-border bg-bg-secondary">
        {/* Traffic lights spacer + drag region */}
        <div data-tauri-drag-region className="h-[38px] flex-shrink-0" />

        {/* Back link — below traffic lights, no border */}
        <button
          className="flex items-center gap-1.5 px-4 pb-3 text-[13px] text-text-muted transition-colors hover:text-text-primary"
          onClick={handleBack}
          aria-label="Back to app"
        >
          <ChevronLeft size={14} strokeWidth={1.8} />
          <span>Settings</span>
        </button>

        {/* Nav sections */}
        <nav className="flex-1 space-y-4 px-3">
          {NAV.map((group) => (
            <div key={group.label}>
              <div className="mb-1 px-2 text-[11px] font-semibold tracking-wider text-text-muted/60 uppercase">
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={navItem({ active: activeSection === item.id })}
                    onClick={() => setActiveSection(item.id)}
                  >
                    <item.icon size={13} strokeWidth={1.8} />
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
        {/* Drag region spacer aligned with sidebar traffic lights zone */}
        <div data-tauri-drag-region className="h-[38px] flex-shrink-0" />
        <div className="mx-auto max-w-lg px-8 pb-6">
          <ActiveComponent />
        </div>
      </div>
    </div>
  );
}

export default SettingsRoute;

export const Route = createFileRoute('/settings')({ component: SettingsRoute });
