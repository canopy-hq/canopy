export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="ui-xs rounded bg-bg-secondary px-1 py-0.5 leading-none text-text-muted">
      {children}
    </kbd>
  );
}
