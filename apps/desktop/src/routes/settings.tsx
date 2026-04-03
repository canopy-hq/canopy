import { useEffect } from 'react';

import { createFileRoute, useNavigate } from '@tanstack/react-router';

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
        <button
          onClick={() => navigate({ to: '/' })}
          className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          title="Close (Esc)"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          >
            <path d="M1 1l10 10M11 1L1 11" />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
        <span className="max-w-[280px] text-center text-sm">Coming soon.</span>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/settings')({ component: SettingsRoute });
