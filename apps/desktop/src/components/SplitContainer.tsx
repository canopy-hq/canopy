import type { ReactNode } from 'react';
import { Children } from 'react';

import { tv } from 'tailwind-variants';

import { Splitter } from './Splitter';

import type { SplitDirection } from '../lib/pane-tree-ops';

const splitContainer = tv({
  base: 'flex h-full w-full',
  variants: { direction: { horizontal: 'flex-row', vertical: 'flex-col' } },
});

interface SplitContainerProps {
  direction: SplitDirection;
  ratios: number[];
  nodeId: string;
  children: ReactNode;
}

/**
 * Flexbox layout container that arranges children according to ratios
 * with draggable splitters between each pair.
 *
 * - horizontal: flex-row (children side by side, splitters are vertical bars)
 * - vertical: flex-col (children stacked, splitters are horizontal bars)
 */
export function SplitContainer({ direction, ratios, nodeId, children }: SplitContainerProps) {
  const childArray = Children.toArray(children);

  return (
    <div className={splitContainer({ direction })}>
      {childArray.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <Splitter nodeId={nodeId} splitIndex={i} direction={direction} />}
          <div className="relative overflow-hidden" style={{ flex: `${ratios[i] ?? 1} 1 0%` }}>
            {child}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

// Inline Fragment to avoid importing React just for Fragment
function Fragment({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
