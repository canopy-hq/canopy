import { describe, it, expect } from 'vitest';

import {
  splitNode,
  removeNode,
  findLeaf,
  findFirstLeaf,
  navigate,
  updateRatio,
  collectLeafPtyIds,
  collectAllLeafPaneIds,
  collectRestorablePaneIds,
  type PaneNode,
  type LeafNode,
  type BranchNode,
} from '../pane-tree-ops';

function makeLeaf(id: string, ptyId: number = 1): LeafNode {
  return { type: 'leaf', id, ptyId };
}

function makeBranch(
  id: string,
  direction: 'horizontal' | 'vertical',
  children: PaneNode[],
  ratios?: number[],
): BranchNode {
  return {
    type: 'branch',
    id,
    direction,
    children,
    ratios: ratios ?? children.map(() => 1 / children.length),
  };
}

describe('splitNode', () => {
  it('splits a root leaf into a branch with 2 children', () => {
    const root = makeLeaf('leaf-1', 1);
    const [newTree, newLeafId] = splitNode(root, 'leaf-1', 'horizontal', 99);

    expect(newTree.type).toBe('branch');
    const branch = newTree as BranchNode;
    expect(branch.direction).toBe('horizontal');
    expect(branch.children).toHaveLength(2);
    expect(branch.ratios).toEqual([0.5, 0.5]);
    // Original leaf is first child
    expect(branch.children[0]!.type).toBe('leaf');
    expect((branch.children[0] as LeafNode).id).toBe('leaf-1');
    // New leaf is second child
    expect(branch.children[1]!.type).toBe('leaf');
    expect((branch.children[1] as LeafNode).ptyId).toBe(99);
    expect(typeof newLeafId).toBe('string');
    expect((branch.children[1] as LeafNode).id).toBe(newLeafId);
  });

  it('inserts sibling when parent branch has SAME direction', () => {
    const root = makeBranch(
      'b1',
      'horizontal',
      [makeLeaf('leaf-1', 1), makeLeaf('leaf-2', 2)],
      [0.5, 0.5],
    );

    const [newTree, newLeafId] = splitNode(root, 'leaf-1', 'horizontal', 99);
    const branch = newTree as BranchNode;
    expect(branch.children).toHaveLength(3);
    // Ratios redistributed evenly (approximately 1/3 each)
    for (const r of branch.ratios) {
      expect(r).toBeCloseTo(1 / 3, 2);
    }
    expect(typeof newLeafId).toBe('string');
  });

  it('wraps leaf in sub-branch when parent has DIFFERENT direction', () => {
    const root = makeBranch(
      'b1',
      'vertical',
      [makeLeaf('leaf-1', 1), makeLeaf('leaf-2', 2)],
      [0.5, 0.5],
    );

    const [newTree, newLeafId] = splitNode(root, 'leaf-1', 'horizontal', 99);
    const branch = newTree as BranchNode;
    expect(branch.children).toHaveLength(2); // Still 2 children at top level
    expect(branch.children[0]!.type).toBe('branch'); // First child is now a sub-branch
    const subBranch = branch.children[0] as BranchNode;
    expect(subBranch.direction).toBe('horizontal');
    expect(subBranch.children).toHaveLength(2);
    expect(typeof newLeafId).toBe('string');
  });

  it('returns a tuple [PaneNode, PaneId]', () => {
    const root = makeLeaf('leaf-1', 1);
    const result = splitNode(root, 'leaf-1', 'vertical', 42);
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('branch');
    expect(typeof result[1]).toBe('string');
  });
});

describe('removeNode', () => {
  it('removes child from 3-child branch and redistributes ratios', () => {
    const root = makeBranch('b1', 'horizontal', [
      makeLeaf('leaf-1', 1),
      makeLeaf('leaf-2', 2),
      makeLeaf('leaf-3', 3),
    ]);
    const result = removeNode(root, 'leaf-2');
    expect(result).not.toBeNull();
    const branch = result as BranchNode;
    expect(branch.children).toHaveLength(2);
    expect(branch.ratios).toEqual([0.5, 0.5]);
  });

  it('collapses branch to surviving child when removing from 2-child branch', () => {
    const root = makeBranch(
      'b1',
      'horizontal',
      [makeLeaf('leaf-1', 1), makeLeaf('leaf-2', 2)],
      [0.5, 0.5],
    );
    const result = removeNode(root, 'leaf-1');
    expect(result).not.toBeNull();
    expect(result!.type).toBe('leaf');
    expect((result as LeafNode).id).toBe('leaf-2');
  });

  it('returns null when removing the last leaf', () => {
    const root = makeLeaf('leaf-1', 1);
    const result = removeNode(root, 'leaf-1');
    expect(result).toBeNull();
  });
});

describe('findLeaf', () => {
  it('finds a leaf in a nested tree', () => {
    const root = makeBranch('b1', 'horizontal', [
      makeLeaf('leaf-1', 1),
      makeBranch('b2', 'vertical', [makeLeaf('leaf-2', 2), makeLeaf('leaf-3', 3)]),
    ]);
    const found = findLeaf(root, 'leaf-3');
    expect(found).not.toBeNull();
    expect(found!.id).toBe('leaf-3');
    expect(found!.ptyId).toBe(3);
  });

  it('returns null for non-existent leaf', () => {
    const root = makeLeaf('leaf-1', 1);
    expect(findLeaf(root, 'no-such-id')).toBeNull();
  });
});

describe('findFirstLeaf', () => {
  it('returns first leaf via DFS', () => {
    const root = makeBranch('b1', 'horizontal', [
      makeBranch('b2', 'vertical', [makeLeaf('leaf-deep', 10), makeLeaf('leaf-2', 2)]),
      makeLeaf('leaf-3', 3),
    ]);
    const first = findFirstLeaf(root);
    expect(first).not.toBeNull();
    expect(first!.id).toBe('leaf-deep');
  });

  it('returns the leaf itself for a single leaf tree', () => {
    const leaf = makeLeaf('only', 1);
    expect(findFirstLeaf(leaf)!.id).toBe('only');
  });
});

describe('navigate', () => {
  it('navigates right to adjacent leaf in horizontal branch', () => {
    const root = makeBranch('b1', 'horizontal', [makeLeaf('left', 1), makeLeaf('right', 2)]);
    expect(navigate(root, 'left', 'right')).toBe('right');
  });

  it('navigates down to adjacent leaf in vertical branch', () => {
    const root = makeBranch('b1', 'vertical', [makeLeaf('top', 1), makeLeaf('bottom', 2)]);
    expect(navigate(root, 'top', 'down')).toBe('bottom');
  });

  it('returns null when at edge', () => {
    const root = makeBranch('b1', 'horizontal', [makeLeaf('left', 1), makeLeaf('right', 2)]);
    expect(navigate(root, 'right', 'right')).toBeNull();
  });

  it('navigates across nested branches', () => {
    // Horizontal top-level with left subtree (vertical) and right leaf
    const root = makeBranch('b1', 'horizontal', [
      makeBranch('b2', 'vertical', [makeLeaf('top-left', 1), makeLeaf('bottom-left', 2)]),
      makeLeaf('right', 3),
    ]);
    // From top-left, navigating right should reach 'right'
    expect(navigate(root, 'top-left', 'right')).toBe('right');
    // From right, navigating left should reach first leaf in left subtree
    const leftTarget = navigate(root, 'right', 'left');
    expect(leftTarget).toBe('top-left');
  });
});

describe('updateRatio', () => {
  it('adjusts ratios by delta', () => {
    const root = makeBranch(
      'b1',
      'horizontal',
      [makeLeaf('left', 1), makeLeaf('right', 2)],
      [0.5, 0.5],
    );
    const result = updateRatio(root, 'b1', 1, 0.05);
    const branch = result as BranchNode;
    expect(branch.ratios[0]).toBeCloseTo(0.55, 10);
    expect(branch.ratios[1]).toBeCloseTo(0.45, 10);
  });

  it('clamps ratios to min 0.1', () => {
    const root = makeBranch(
      'b1',
      'horizontal',
      [makeLeaf('left', 1), makeLeaf('right', 2)],
      [0.15, 0.85],
    );
    // Trying to shrink left by 0.1 would push it to 0.05, should clamp to 0.1
    const result = updateRatio(root, 'b1', 1, -0.1);
    const branch = result as BranchNode;
    expect(branch.ratios[0]!).toBeGreaterThanOrEqual(0.1);
    expect(branch.ratios[1]!).toBeLessThanOrEqual(0.9);
    expect(branch.ratios[0]! + branch.ratios[1]!).toBeCloseTo(1.0, 10);
  });
});

describe('collectLeafPtyIds', () => {
  it('returns ptyId from a single leaf', () => {
    expect(collectLeafPtyIds(makeLeaf('a', 42))).toEqual([42]);
  });

  it('skips leaves with ptyId <= 0', () => {
    expect(collectLeafPtyIds(makeLeaf('a', -1))).toEqual([]);
    expect(collectLeafPtyIds(makeLeaf('a', 0))).toEqual([]);
  });

  it('collects from nested branch tree', () => {
    const tree = makeBranch('b1', 'horizontal', [
      makeLeaf('l1', 10),
      makeBranch('b2', 'vertical', [makeLeaf('l2', 20), makeLeaf('l3', 30)]),
    ]);
    expect(collectLeafPtyIds(tree)).toEqual([10, 20, 30]);
  });

  it('filters out uninitialized leaves in mixed tree', () => {
    const tree = makeBranch('b1', 'horizontal', [
      makeLeaf('l1', 5),
      makeLeaf('l2', -1),
      makeLeaf('l3', 15),
    ]);
    expect(collectLeafPtyIds(tree)).toEqual([5, 15]);
  });
});

describe('collectAllLeafPaneIds', () => {
  it('returns paneId from a single leaf regardless of ptyId', () => {
    expect(collectAllLeafPaneIds(makeLeaf('p1', -1))).toEqual(['p1']);
    expect(collectAllLeafPaneIds(makeLeaf('p2', 42))).toEqual(['p2']);
    expect(collectAllLeafPaneIds(makeLeaf('p3', -2))).toEqual(['p3']);
  });

  it('collects all pane IDs from nested tree including uninitialized leaves', () => {
    const tree = makeBranch('b1', 'horizontal', [
      makeLeaf('l1', 5),
      makeLeaf('l2', -1),
      makeBranch('b2', 'vertical', [makeLeaf('l3', 15), makeLeaf('l4', -1)]),
    ]);
    expect(collectAllLeafPaneIds(tree)).toEqual(['l1', 'l2', 'l3', 'l4']);
  });
});

describe('collectRestorablePaneIds', () => {
  it('returns paneId for unspawned leaf (ptyId -1)', () => {
    expect(collectRestorablePaneIds(makeLeaf('p1', -1))).toEqual(['p1']);
  });

  it('returns paneId for alive leaf (ptyId > 0)', () => {
    expect(collectRestorablePaneIds(makeLeaf('p1', 42))).toEqual(['p1']);
  });

  it('returns empty for killed leaf (ptyId -2)', () => {
    expect(collectRestorablePaneIds(makeLeaf('p1', -2))).toEqual([]);
  });

  it('returns both paneIds for branch with 2 live leaves', () => {
    const tree = makeBranch('b1', 'horizontal', [makeLeaf('p1', -1), makeLeaf('p2', 5)]);
    expect(collectRestorablePaneIds(tree)).toEqual(['p1', 'p2']);
  });

  it('returns only live paneId when one leaf is killed', () => {
    const tree = makeBranch('b1', 'horizontal', [makeLeaf('live', -1), makeLeaf('dead', -2)]);
    expect(collectRestorablePaneIds(tree)).toEqual(['live']);
  });

  it('returns live paneIds from nested branch, skipping killed leaf', () => {
    const tree = makeBranch('b1', 'horizontal', [
      makeLeaf('p1', -1),
      makeBranch('b2', 'vertical', [makeLeaf('p2', -2), makeLeaf('p3', 7)]),
    ]);
    expect(collectRestorablePaneIds(tree)).toEqual(['p1', 'p3']);
  });

  it('returns empty when all leaves are killed', () => {
    const tree = makeBranch('b1', 'horizontal', [makeLeaf('p1', -2), makeLeaf('p2', -2)]);
    expect(collectRestorablePaneIds(tree)).toEqual([]);
  });
});
