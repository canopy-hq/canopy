import { useAgents } from '../hooks/useCollections';

export function StatusBar() {
  const agents = useAgents();

  const runningCount = agents.filter((a) => a.status === 'running').length;
  const waitingCount = agents.filter((a) => a.status === 'waiting').length;

  return (
    <div
      className="flex h-6 flex-shrink-0 items-center justify-end border-t border-border bg-bg-primary px-3 text-text-muted"
      style={{ fontSize: '11px', fontFamily: 'Menlo, Monaco, "Courier New", monospace' }}
    >
      <div className="flex items-center gap-3">
        {(runningCount > 0 || waitingCount > 0) && (
          <span className="flex items-center gap-1">
            {runningCount > 0 && (
              <span style={{ color: 'var(--agent-running)' }}>{runningCount} working</span>
            )}
            {runningCount > 0 && waitingCount > 0 && (
              <span style={{ color: 'var(--text-muted)', opacity: 0.6 }}>&middot;</span>
            )}
            {waitingCount > 0 && (
              <span style={{ color: 'var(--agent-waiting)' }}>{waitingCount} waiting</span>
            )}
          </span>
        )}
        <span className="opacity-60">Cmd+B Sidebar</span>
        <span className="opacity-60">Cmd+D Split</span>
        <span className="opacity-60">Cmd+T Tab</span>
        <span className="opacity-60">Cmd+Shift+O Overview</span>
      </div>
    </div>
  );
}