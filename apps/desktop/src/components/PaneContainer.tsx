import { SplitContainer } from "./SplitContainer";
import { TerminalPane } from "./TerminalPane";

import type { PaneNode } from "../lib/pane-tree-ops";

/**
 * Renders a pane tree into split containers and terminal panes.
 * Receives its root as a prop -- App.tsx renders one PaneContainer per tab.
 */
export function PaneContainer({ root }: { root: PaneNode }) {
  return <PaneNodeRenderer node={root} />;
}

function PaneNodeRenderer({ node }: { node: PaneNode }) {
  if (node.type === "leaf") {
    return <TerminalPane paneId={node.id} ptyId={node.ptyId} />;
  }
  return (
    <SplitContainer direction={node.direction} ratios={node.ratios} nodeId={node.id}>
      {node.children.map((child) => (
        <PaneNodeRenderer key={child.id} node={child} />
      ))}
    </SplitContainer>
  );
}
