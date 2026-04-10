import { useState } from 'react';

import { tv } from 'tailwind-variants';

import { useSplitterDrag } from '../hooks/useSplitterDrag';

import type { SplitDirection } from '../lib/pane-tree-ops';

const splitter = tv({
  base: 'flex shrink-0',
  variants: {
    direction: {
      horizontal: 'h-full w-[6px] cursor-col-resize items-center',
      vertical: 'h-[6px] w-full cursor-row-resize justify-center',
    },
  },
});

const splitterLine = tv({
  base: 'transition-colors duration-150',
  variants: {
    direction: { horizontal: 'h-full w-[2px]', vertical: 'h-[2px] w-full' },
    state: { idle: 'bg-edge', hovered: 'bg-splitter-hover', dragging: 'bg-accent' },
  },
});

interface SplitterProps {
  nodeId: string;
  splitIndex: number;
  direction: SplitDirection;
}

/**
 * Draggable divider between panes.
 *
 * 6px hit area (transparent) with a 2px visible line centered inside.
 * Visual states: idle, hover, active/dragging.
 */
export function Splitter({ nodeId, splitIndex, direction }: SplitterProps) {
  const { onPointerDown } = useSplitterDrag(nodeId, splitIndex, direction);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const state = isDragging
    ? ('dragging' as const)
    : isHovered
      ? ('hovered' as const)
      : ('idle' as const);

  return (
    <div
      className={splitter({ direction })}
      onPointerDown={(e) => {
        setIsDragging(true);
        const handleUp = () => {
          setIsDragging(false);
          document.removeEventListener('pointerup', handleUp);
        };
        document.addEventListener('pointerup', handleUp);
        onPointerDown(e);
      }}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
    >
      <div className={splitterLine({ direction, state })} />
    </div>
  );
}
