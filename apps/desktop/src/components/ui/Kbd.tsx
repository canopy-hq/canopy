export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded bg-bg-secondary px-1 py-0.5 ui-xs leading-none text-text-muted">
      {children}
    </kbd>
  );
}
