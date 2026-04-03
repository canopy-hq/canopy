import { useEffect } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

function SettingsRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate({ to: '/' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-5 h-12 border-b border-border flex-shrink-0">
        <span className="text-sm font-semibold text-text-primary">Settings</span>
        <button
          onClick={() => navigate({ to: '/' })}
          className="flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
          title="Close (Esc)"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
        <span className="text-sm text-center max-w-[280px]">Coming soon.</span>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings')({ component: SettingsRoute });
