import { useSensor, useSensors, PointerSensor, type Modifier } from '@dnd-kit/core';

/** Shared PointerSensor with a 5px activation threshold to keep clicks working. */
export function useDragSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
}

export const restrictToHorizontalAxis: Modifier = ({ transform }) => ({ ...transform, y: 0 });
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/** Transition for displaced items during sort — ease-out feels more natural than linear ease. */
export const sortableTransition = { duration: 200, easing: 'ease-out' } as const;
