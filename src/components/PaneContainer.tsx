import { usePaneTreeStore } from '../stores/pane-tree';
import type { PaneNode } from '../lib/pane-tree-ops';
import { SplitContainer } from './SplitContainer';
import { TerminalPane } from './TerminalPane';

/**
 * Root component that reads the pane tree from the store
 * and recursively renders it into split containers and terminal panes.
 */
export function PaneContainer() {
  const root = usePaneTreeStore((s) => s.root);
  return <PaneNodeRenderer node={root} />;
}

function PaneNodeRenderer({ node }: { node: PaneNode }) {
  if (node.type === 'leaf') {
    return <TerminalPane paneId={node.id} ptyId={node.ptyId} />;
  }
  return (
    <SplitContainer direction={node.direction} ratios={node.ratios} nodeId={node.id}>
      {node.children.map((child) => (
        <PaneNodeRenderer key={child.type === 'leaf' ? child.id : child.id} node={child} />
      ))}
    </SplitContainer>
  );
}
