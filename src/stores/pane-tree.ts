import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import {
  splitNode,
  removeNode,
  findFirstLeaf,
  navigate,
  updateRatio,
  type PaneNode,
  type PaneId,
  type SplitDirection,
} from '../lib/pane-tree-ops';

interface PaneTreeState {
  root: PaneNode;
  focusedPaneId: PaneId | null;
  splitPane: (paneId: PaneId, direction: SplitDirection, newPtyId: number) => void;
  closePane: (paneId: PaneId) => void;
  setFocus: (paneId: PaneId) => void;
  navigate: (direction: 'up' | 'down' | 'left' | 'right') => void;
  updateRatio: (branchId: string, splitIndex: number, delta: number) => void;
  setPtyId: (paneId: PaneId, ptyId: number) => void;
}

export const usePaneTreeStore = create<PaneTreeState>()(
  immer((set, get) => ({
    root: { type: 'leaf', id: 'initial', ptyId: -1 } as PaneNode,
    focusedPaneId: 'initial',

    splitPane: (paneId, direction, newPtyId) =>
      set((state) => {
        const [newTree, newLeafId] = splitNode(state.root, paneId, direction, newPtyId);
        state.root = newTree;
        state.focusedPaneId = newLeafId;
      }),

    closePane: (paneId) =>
      set((state) => {
        const result = removeNode(state.root, paneId);
        if (result === null) {
          // Last pane closed -- reset to sentinel leaf with ptyId=-1
          // TerminalPane will detect ptyId=-1 and spawn a new PTY
          const newId = crypto.randomUUID();
          state.root = { type: 'leaf', id: newId, ptyId: -1 };
          state.focusedPaneId = newId;
          return;
        }
        state.root = result;
        // If closed pane was focused, focus first leaf in remaining tree
        if (state.focusedPaneId === paneId) {
          const firstLeaf = findFirstLeaf(result);
          state.focusedPaneId = firstLeaf?.id ?? null;
        }
      }),

    setFocus: (paneId) => set({ focusedPaneId: paneId }),

    navigate: (direction) => {
      const { root, focusedPaneId } = get();
      if (!focusedPaneId) return;
      const targetId = navigate(root, focusedPaneId, direction);
      if (targetId) set({ focusedPaneId: targetId });
    },

    updateRatio: (branchId, splitIndex, delta) =>
      set((state) => {
        state.root = updateRatio(state.root, branchId, splitIndex, delta);
      }),

    setPtyId: (paneId, ptyId) =>
      set((state) => {
        const setInTree = (node: PaneNode): void => {
          if (node.type === 'leaf') {
            if (node.id === paneId) node.ptyId = ptyId;
            return;
          }
          for (const child of node.children) setInTree(child);
        };
        setInTree(state.root);
      }),
  })),
);
