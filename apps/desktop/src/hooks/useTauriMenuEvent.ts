import { useEffect, useRef } from 'react';

export function useTauriMenuEvent(event: string, handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void import('@tauri-apps/api/event').then(({ listen }) => {
      if (cancelled) return;
      void listen(event, () => handlerRef.current()).then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      });
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [event, enabled]);
}
