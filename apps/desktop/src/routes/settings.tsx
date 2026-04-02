import { createFileRoute } from '@tanstack/react-router';

function SettingsRoute() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
      <span className="text-lg font-semibold text-text-primary">Settings</span>
      <span className="text-sm text-center max-w-[280px]">Coming soon.</span>
    </div>
  );
}

export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
});
