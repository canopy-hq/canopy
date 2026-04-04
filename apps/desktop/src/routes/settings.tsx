import { useEffect } from 'react';

import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { X } from 'lucide-react';

import { Button, Tooltip } from '../components/ui';

function SettingsRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void navigate({ to: '/' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border px-5">
        <span className="text-sm font-semibold text-text-primary">Settings</span>
        <Tooltip
          label={
            <>
              Close{' '}
              <kbd className="rounded bg-bg-secondary px-1 py-0.5 text-[10px] leading-none text-text-muted">
                Esc
              </kbd>
            </>
          }
          placement="left"
        >
          <Button
            iconOnly
            variant="ghost"
            aria-label="Close settings"
            onPress={() => void navigate({ to: '/' })}
          >
            <X size={13} strokeWidth={1.8} />
          </Button>
        </Tooltip>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
        <span className="max-w-[280px] text-center text-sm">Coming soon.</span>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings')({ component: SettingsRoute });
