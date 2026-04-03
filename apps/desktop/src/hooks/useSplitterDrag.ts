import { useCallback, useRef } from "react";

import { updateRatio } from "../lib/tab-actions";

import type { SplitDirection } from "../lib/pane-tree-ops";

/**
 * Hook for pointer-capture-based splitter drag behavior.
 *
 * On pointerdown, captures the pointer and attaches document-level
 * pointermove/pointerup listeners. Computes delta as a fraction of the
 * parent container size, then updates the pane tree ratios.
 */
export function useSplitterDrag(
  nodeId: string,
  splitIndex: number,
  direction: SplitDirection,
): { onPointerDown: (e: React.PointerEvent) => void } {
  const startPosRef = useRef(0);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);

      const isHorizontal = direction === "horizontal";
      startPosRef.current = isHorizontal ? e.clientX : e.clientY;
      const parent = target.parentElement;
      const totalSize = parent ? (isHorizontal ? parent.offsetWidth : parent.offsetHeight) : 1;

      const onPointerMove = (moveEvent: PointerEvent) => {
        const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        const delta = (currentPos - startPosRef.current) / totalSize;
        startPosRef.current = currentPos;

        updateRatio(nodeId, splitIndex, delta);
      };

      const onPointerUp = () => {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
      };

      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
    },
    [nodeId, splitIndex, direction],
  );

  return { onPointerDown };
}
