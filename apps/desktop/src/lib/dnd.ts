import { useSensor, useSensors, PointerSensor, type Modifier } from '@dnd-kit/core';

/** Shared PointerSensor with a 5px activation threshold to keep clicks working. */
export function useDragSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
}

export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function restrictToMin(axis: 'x' | 'y', coord: 'left' | 'top', getMin: () => number): Modifier {
  return ({ transform, draggingNodeRect }) => {
    if (!draggingNodeRect) return transform;
    const min = getMin();
    const projected = draggingNodeRect[coord] + transform[axis];
    if (projected < min) return { ...transform, [axis]: min - draggingNodeRect[coord] };
    return transform;
  };
}

/** Prevents the drag overlay from moving above `getMinY()`. */
export function restrictToMinTop(getMinY: () => number): Modifier {
  return restrictToMin('y', 'top', getMinY);
}

/** Prevents the drag overlay from moving left of `getMinX()`. */
export function restrictToMinLeft(getMinX: () => number): Modifier {
  return restrictToMin('x', 'left', getMinX);
}

/** Transition for displaced items during sort — ease-out feels more natural than linear ease. */
export const sortableTransition = { duration: 200, easing: 'ease-out' } as const;
