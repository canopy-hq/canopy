import { createFileRoute } from "@tanstack/react-router";

function SettingsRoute() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-text-muted">
      <span className="text-lg font-semibold text-text-primary">Settings</span>
      <span className="max-w-[280px] text-center text-sm">Coming soon.</span>
    </div>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsRoute,
});
