import { useSensor, useSensors, PointerSensor, type Modifier } from '@dnd-kit/core';

/** Shared PointerSensor with a 5px activation threshold to keep clicks working. */
export function useDragSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
}

export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * Returns a modifier that prevents the drag overlay from moving above `getMinY()`.
 * Pass a stable getter (e.g. reading from a ref) — it is called on every pointer move.
 */
export function restrictToMinTop(getMinY: () => number): Modifier {
  return ({ transform, draggingNodeRect }) => {
    if (!draggingNodeRect) return transform;
    const minY = getMinY();
    const projectedTop = draggingNodeRect.top + transform.y;
    if (projectedTop < minY) {
      return { ...transform, y: minY - draggingNodeRect.top };
    }
    return transform;
  };
}

/** Transition for displaced items during sort — ease-out feels more natural than linear ease. */
export const sortableTransition = { duration: 200, easing: 'ease-out' } as const;
