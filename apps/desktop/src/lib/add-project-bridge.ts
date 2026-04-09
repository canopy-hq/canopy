// Single-subscriber bridge — only __root.tsx ever registers.
type Handler = () => void;
let _handler: Handler | null = null;

export function onOpenAddProjectDialog(handler: Handler): () => void {
  if (import.meta.env.DEV && _handler) {
    console.warn('onOpenAddProjectDialog: replacing an existing handler — double mount?');
  }
  _handler = handler;
  return () => {
    _handler = null;
  };
}

export function openAddProjectDialogViaBridge(): void {
  _handler?.();
}
