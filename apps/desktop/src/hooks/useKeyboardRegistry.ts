import { useEffect, useRef } from 'react';

export interface Keybinding {
  key: string;
  meta: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  /** If defined and returns false, the binding is skipped and the event propagates unchanged. */
  condition?: () => boolean;
}

export function useKeyboardRegistry(bindings: Keybinding[]): void {
  const bindingsRef = useRef(bindings);
  bindingsRef.current = bindings;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      for (const binding of bindingsRef.current) {
        if (
          e.key === binding.key &&
          e.metaKey === binding.meta &&
          e.shiftKey === (binding.shift ?? false) &&
          e.altKey === (binding.alt ?? false)
        ) {
          if (binding.condition && !binding.condition()) continue;
          e.preventDefault();
          e.stopPropagation();
          binding.action();
          return;
        }
      }
      // No match -- let event propagate (terminal will handle it)
    };

    document.addEventListener('keydown', handler, { capture: true });
    return () => {
      document.removeEventListener('keydown', handler, { capture: true });
    };
  }, []);
}
