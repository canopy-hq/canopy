import { useState } from 'react';
import { useSplitterDrag } from '../hooks/useSplitterDrag';
import type { SplitDirection } from '../lib/pane-tree-ops';

interface SplitterProps {
  nodeId: string;
  splitIndex: number;
  direction: SplitDirection;
}

/**
 * Draggable divider between panes.
 *
 * 6px hit area (transparent) with a 2px visible line centered inside.
 * Visual states: idle (#2a2a3e), hover (#3a3a5e), active/dragging (#3b82f6).
 */
export function Splitter({ nodeId, splitIndex, direction }: SplitterProps) {
  const { onPointerDown } = useSplitterDrag(nodeId, splitIndex, direction);
  const [isHovered, setIsHovered] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const isHorizontal = direction === 'horizontal';

  const lineColor = isDragging ? '#3b82f6' : isHovered ? '#3a3a5e' : '#2a2a3e';

  return (
    <div
      className={`flex-shrink-0 ${isHorizontal ? 'cursor-col-resize' : 'cursor-row-resize'}`}
      style={{
        width: isHorizontal ? '6px' : '100%',
        height: isHorizontal ? '100%' : '6px',
        display: 'flex',
        alignItems: isHorizontal ? 'center' : undefined,
        justifyContent: !isHorizontal ? 'center' : undefined,
      }}
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
      <div
        style={{
          width: isHorizontal ? '2px' : '100%',
          height: isHorizontal ? '100%' : '2px',
          backgroundColor: lineColor,
          transition: 'background-color 150ms ease',
        }}
      />
    </div>
  );
}
