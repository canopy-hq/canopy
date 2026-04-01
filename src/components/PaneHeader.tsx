/**
 * Floating CWD overlay for a terminal pane.
 *
 * Positioned absolute top-right, shows the last 2 path segments
 * of the current working directory. Falls back to '~' when empty.
 */
export function PaneHeader({ cwd, isFocused }: { cwd: string; isFocused: boolean }) {
  const displayPath = cwd
    ? cwd.split('/').filter(Boolean).slice(-2).join('/')
    : '~';

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        zIndex: 10,
        background: 'color-mix(in srgb, var(--bg-tertiary) 85%, transparent)',
        backdropFilter: 'blur(4px)',
        borderRadius: '0 0 0 6px',
        padding: '4px 16px',
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: '12px',
        lineHeight: 1,
        color: isFocused ? 'var(--text-primary)' : 'var(--text-muted)',
        pointerEvents: 'none',
      }}
    >
      {displayPath}
    </div>
  );
}
