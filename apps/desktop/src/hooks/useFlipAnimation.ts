import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

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
  containerRef: RefObject<HTMLElement | null>,
  axis: 'vertical' | 'horizontal' = 'vertical',
): { snapshot: () => void } {
  const saved = useRef<Map<string, number>>(new Map());
  const pending = useRef(false);
  const animations = useRef<Animation[]>([]);

  const isHorizontal = axis === 'horizontal';
  const readPos = (el: HTMLElement) =>
    isHorizontal ? el.getBoundingClientRect().left : el.getBoundingClientRect().top;
  const makeTransform = (delta: number) =>
    isHorizontal ? `translateX(${delta}px)` : `translateY(${delta}px)`;

  const snapshot = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const map = new Map<string, number>();
    for (const el of container.querySelectorAll<HTMLElement>(':scope > [data-flip-id]')) {
      map.set(el.dataset.flipId!, readPos(el));
    }
    saved.current = map;
    pending.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis]);

  // Cancel any in-flight animations on unmount.
  useLayoutEffect(
    () => () => {
      for (const anim of animations.current) anim.cancel();
    },
    [],
  );

  // Intentionally no dependency array — runs after every render, but only acts
  // when a snapshot is pending (set by the drag-end handler).
  useLayoutEffect(() => {
    if (!pending.current) return;
    pending.current = false;

    const container = containerRef.current;
    if (!container || !saved.current.size) return;

    // Batch reads before writes to avoid layout thrashing.
    const moves: Array<{ el: HTMLElement; delta: number }> = [];
    for (const el of container.querySelectorAll<HTMLElement>(':scope > [data-flip-id]')) {
      const prevPos = saved.current.get(el.dataset.flipId!);
      if (prevPos === undefined) continue;
      const delta = prevPos - readPos(el);
      if (Math.abs(delta) >= 1) moves.push({ el, delta });
    }

    for (const { el, delta } of moves) {
      const anim = el.animate(
        [{ transform: makeTransform(delta) }, { transform: 'translate(0, 0)' }],
        { duration: 200, easing: 'ease-out' },
      );
      animations.current.push(anim);
      anim.onfinish = () => {
        animations.current = animations.current.filter((a) => a !== anim);
      };
    }
  });

  return { snapshot };
}
