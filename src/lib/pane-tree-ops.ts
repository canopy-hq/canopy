export type PaneId = string;
export type SplitDirection = 'horizontal' | 'vertical';

export interface LeafNode {
  type: 'leaf';
  id: PaneId;
  ptyId: number;
}

export interface BranchNode {
  type: 'branch';
  id: string;
  direction: SplitDirection;
  ratios: number[];
  children: PaneNode[];
}

export type PaneNode = LeafNode | BranchNode;

// ── Helpers ──────────────────────────────────────────────────────────

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Build a map of childId -> parentBranch for path lookups.
 */
function buildParentMap(
  node: PaneNode,
  map: Map<string, BranchNode> = new Map(),
): Map<string, BranchNode> {
  if (node.type === 'branch') {
    for (const child of node.children) {
      map.set(child.type === 'leaf' ? child.id : child.id, node);
      if (child.type === 'branch') buildParentMap(child, map);
    }
  }
  return map;
}

function evenRatios(n: number): number[] {
  const base = Math.floor((1 / n) * 1000) / 1000;
  const ratios = Array(n).fill(base);
  // Distribute remainder to last element so sum === 1
  const remainder = 1 - base * n;
  ratios[n - 1] = +(ratios[n - 1] + remainder).toFixed(3);
  return ratios;
}

// ── splitNode ────────────────────────────────────────────────────────

export function splitNode(
  tree: PaneNode,
  targetId: PaneId,
  direction: SplitDirection,
  newPtyId: number,
): [PaneNode, PaneId] {
  const cloned = deepClone(tree);
  const newLeafId = crypto.randomUUID();
  const newLeaf: LeafNode = { type: 'leaf', id: newLeafId, ptyId: newPtyId };

  // If the root itself is the target leaf
  if (cloned.type === 'leaf' && cloned.id === targetId) {
    const branch: BranchNode = {
      type: 'branch',
      id: crypto.randomUUID(),
      direction,
      ratios: [0.5, 0.5],
      children: [cloned, newLeaf],
    };
    return [branch, newLeafId];
  }

  // DFS to find and split
  const parentMap = buildParentMap(cloned);
  const parent = parentMap.get(targetId);
  if (!parent) throw new Error(`Target leaf "${targetId}" not found`);

  const childIndex = parent.children.findIndex(
    (c) => (c.type === 'leaf' ? c.id : c.id) === targetId,
  );

  if (parent.direction === direction) {
    // Same direction: insert sibling after target
    parent.children.splice(childIndex + 1, 0, newLeaf);
    parent.ratios = evenRatios(parent.children.length);
  } else {
    // Different direction: wrap target in new sub-branch
    const target = parent.children[childIndex];
    const subBranch: BranchNode = {
      type: 'branch',
      id: crypto.randomUUID(),
      direction,
      ratios: [0.5, 0.5],
      children: [target, newLeaf],
    };
    parent.children[childIndex] = subBranch;
  }

  return [cloned, newLeafId];
}

// ── removeNode ───────────────────────────────────────────────────────

export function removeNode(
  tree: PaneNode,
  targetId: PaneId,
): PaneNode | null {
  // Single leaf case
  if (tree.type === 'leaf') {
    return tree.id === targetId ? null : tree;
  }

  const cloned = deepClone(tree);
  return removeNodeInPlace(cloned, targetId);
}

function removeNodeInPlace(
  node: PaneNode,
  targetId: PaneId,
): PaneNode | null {
  if (node.type === 'leaf') return node;

  const branch = node as BranchNode;

  // Check if target is a direct child
  const idx = branch.children.findIndex(
    (c) => c.type === 'leaf' && c.id === targetId,
  );

  if (idx !== -1) {
    branch.children.splice(idx, 1);
    if (branch.children.length === 0) return null;
    if (branch.children.length === 1) return branch.children[0];
    branch.ratios = evenRatios(branch.children.length);
    return branch;
  }

  // Recurse into child branches
  for (let i = 0; i < branch.children.length; i++) {
    const child = branch.children[i];
    if (child.type === 'branch') {
      const result = removeNodeInPlace(child, targetId);
      if (result === null) {
        // Child branch became empty
        branch.children.splice(i, 1);
        if (branch.children.length === 0) return null;
        if (branch.children.length === 1) return branch.children[0];
        branch.ratios = evenRatios(branch.children.length);
        return branch;
      }
      if (result !== child) {
        // Child branch collapsed
        branch.children[i] = result;
      }
    }
  }

  return branch;
}

// ── findLeaf ─────────────────────────────────────────────────────────

export function findLeaf(
  tree: PaneNode,
  targetId: PaneId,
): LeafNode | null {
  if (tree.type === 'leaf') {
    return tree.id === targetId ? tree : null;
  }
  for (const child of tree.children) {
    const found = findLeaf(child, targetId);
    if (found) return found;
  }
  return null;
}

// ── findFirstLeaf ────────────────────────────────────────────────────

export function findFirstLeaf(tree: PaneNode): LeafNode | null {
  if (tree.type === 'leaf') return tree;
  for (const child of tree.children) {
    const found = findFirstLeaf(child);
    if (found) return found;
  }
  return null;
}

// ── navigate ─────────────────────────────────────────────────────────

/**
 * Navigate from `fromId` in a direction. Returns the target pane ID or null.
 *
 * Strategy: walk up from the source leaf to find a branch whose axis matches
 * the navigation direction, move to the adjacent child in that direction, then
 * descend to the nearest leaf on the "entering" side.
 */
export function navigate(
  tree: PaneNode,
  fromId: PaneId,
  direction: 'up' | 'down' | 'left' | 'right',
): PaneId | null {
  const axis: SplitDirection =
    direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical';
  const forward = direction === 'right' || direction === 'down';

  // Build path from root to the target leaf
  const path = findPath(tree, fromId);
  if (!path) return null;

  // Walk up the path looking for a matching-axis branch where we can move
  for (let i = path.length - 1; i >= 0; i--) {
    const node = path[i];
    if (node.type !== 'branch' || node.direction !== axis) continue;

    // Find which child the next path element is in
    const childNode = path[i + 1];
    if (!childNode) continue;
    const childIdx = node.children.findIndex((c) => c.id === childNode.id);
    if (childIdx === -1) continue;

    const nextIdx = forward ? childIdx + 1 : childIdx - 1;
    if (nextIdx < 0 || nextIdx >= node.children.length) continue;

    // Descend into the adjacent child to find the nearest leaf
    const targetChild = node.children[nextIdx];
    const leaf = findFirstLeaf(targetChild);
    return leaf?.id ?? null;
  }

  return null;
}

function findLastLeaf(tree: PaneNode): LeafNode | null {
  if (tree.type === 'leaf') return tree;
  for (let i = tree.children.length - 1; i >= 0; i--) {
    const found = findLastLeaf(tree.children[i]);
    if (found) return found;
  }
  return null;
}

function findPath(tree: PaneNode, targetId: PaneId): PaneNode[] | null {
  if (tree.type === 'leaf') {
    return tree.id === targetId ? [tree] : null;
  }
  for (const child of tree.children) {
    const subPath = findPath(child, targetId);
    if (subPath) return [tree, ...subPath];
  }
  return null;
}

// ── updateRatio ──────────────────────────────────────────────────────

const MIN_RATIO = 0.1;

export function updateRatio(
  tree: PaneNode,
  branchId: string,
  splitIndex: number,
  delta: number,
): PaneNode {
  const cloned = deepClone(tree);
  applyRatioUpdate(cloned, branchId, splitIndex, delta);
  return cloned;
}

function applyRatioUpdate(
  node: PaneNode,
  branchId: string,
  splitIndex: number,
  delta: number,
): void {
  if (node.type === 'leaf') return;
  if (node.id === branchId) {
    const leftIdx = splitIndex - 1;
    const rightIdx = splitIndex;

    let newLeft = node.ratios[leftIdx] + delta;
    let newRight = node.ratios[rightIdx] - delta;

    // Clamp
    if (newLeft < MIN_RATIO) {
      newRight -= MIN_RATIO - newLeft;
      newLeft = MIN_RATIO;
    }
    if (newRight < MIN_RATIO) {
      newLeft -= MIN_RATIO - newRight;
      newRight = MIN_RATIO;
    }

    node.ratios[leftIdx] = newLeft;
    node.ratios[rightIdx] = newRight;
    return;
  }
  for (const child of node.children) {
    applyRatioUpdate(child, branchId, splitIndex, delta);
  }
}
