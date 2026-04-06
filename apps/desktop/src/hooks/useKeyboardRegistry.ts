import { useEffect, useRef } from 'react';

type KeyOrCode = { key: string; code?: string } | { key?: string; code: string };

export type Keybinding = KeyOrCode & {
  meta: boolean;
  shift?: boolean;
  alt?: boolean;
  action: () => void;
  /** If defined and returns false, the binding is skipped and the event propagates unchanged. */
  condition?: () => boolean;
};

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
