import type { ReactNode } from "react";
import { Children } from "react";

import { Splitter } from "./Splitter";

import type { SplitDirection } from "../lib/pane-tree-ops";

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
  const isHorizontal = direction === "horizontal";
  const childArray = Children.toArray(children);

  return (
    <div className={`flex h-full w-full ${isHorizontal ? "flex-row" : "flex-col"}`}>
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
