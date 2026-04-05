import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * FLIP animation for sortable list reordering.
 *
 * Call `snapshot()` inside the drag-end handler — before any state updates —
 * while the DOM still has dnd-kit's transforms applied (live-preview positions).
 * The next `useLayoutEffect` after the drop render reads the new natural positions
 * and animates each element from its snapshot position using the Web Animations API.
 *
 * Using Web Animations API (not CSS transitions) so React re-renders cannot
 * interrupt the animation by overwriting inline styles.
 */
export function useFlipAnimation(
  containerRef: React.RefObject<HTMLElement | null>,
  axis: 'vertical' | 'horizontal' = 'vertical',
): { snapshot: () => void } {
  const saved = useRef<Map<string, number>>(new Map());
  const pending = useRef(false);

  const snapshot = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new Map<string, number>();
    for (const el of container.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      map.set(
        el.dataset.flipId!,
        axis === 'horizontal' ? el.getBoundingClientRect().left : el.getBoundingClientRect().top,
      );
    }
    saved.current = map;
    pending.current = true;
  }, [containerRef, axis]);

  // Intentionally no dependency array — runs after every render, but only acts
  // when a snapshot is pending (set by the drag-end handler).
  useLayoutEffect(() => {
    if (!pending.current) return;
    pending.current = false;

    const container = containerRef.current;
    if (!container || !saved.current.size) return;

    const readPos = (el: HTMLElement) =>
      axis === 'horizontal' ? el.getBoundingClientRect().left : el.getBoundingClientRect().top;

    for (const el of container.querySelectorAll<HTMLElement>('[data-flip-id]')) {
      const id = el.dataset.flipId!;
      const prevPos = saved.current.get(id);
      if (prevPos === undefined) continue;
      const delta = prevPos - readPos(el);
      if (Math.abs(delta) < 1) continue;
      const from = axis === 'horizontal' ? `translateX(${delta}px)` : `translateY(${delta}px)`;
      el.animate([{ transform: from }, { transform: 'translate(0, 0)' }], {
        duration: 200,
        easing: 'ease-out',
      });
    }
    saved.current = new Map();
  });

  return { snapshot };
}
