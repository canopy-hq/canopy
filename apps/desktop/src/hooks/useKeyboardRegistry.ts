import { useEffect, useRef } from 'react';

export interface Keybinding {
  /** Logical key value (e.key) — layout-dependent. Use `code` for physical keys like digits. */
  key?: string;
  /** Physical key code (e.code) — layout-independent. Use for digit shortcuts (e.g. 'Digit1'). */
  code?: string;
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
        const keyMatch = binding.key ? e.key === binding.key : true;
        const codeMatch = binding.code ? e.code === binding.code : true;
        if (
          keyMatch &&
          codeMatch &&
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
