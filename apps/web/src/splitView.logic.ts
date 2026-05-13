import type { ThreadId } from "@t3tools/contracts";
import type { LeafPane, Pane, PaneId, SplitDirection, SplitNode } from "./splitViewStore";

export function findLeafPaneById(root: Pane, paneId: PaneId): LeafPane | null {
  if (root.id === paneId) return root.kind === "leaf" ? root : null;
  if (root.kind === "leaf") return null;
  return findLeafPaneById(root.first, paneId) ?? findLeafPaneById(root.second, paneId);
}

export function collectLeaves(root: Pane): LeafPane[] {
  if (root.kind === "leaf") return [root];
  return [...collectLeaves(root.first), ...collectLeaves(root.second)];
}

export function replacePaneInTree(root: Pane, paneId: PaneId, replacement: Pane): Pane {
  if (root.id === paneId) return replacement;
  if (root.kind === "leaf") return root;
  const first = replacePaneInTree(root.first, paneId, replacement);
  const second = replacePaneInTree(root.second, paneId, replacement);
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}

function findParentSplitNode(root: Pane, paneId: PaneId): SplitNode | null {
  if (root.kind === "leaf") return null;
  if (root.first.id === paneId || root.second.id === paneId) return root;
  return findParentSplitNode(root.first, paneId) ?? findParentSplitNode(root.second, paneId);
}

function findPaneDepth(root: Pane, paneId: PaneId): number | null {
  if (root.id === paneId) return 0;
  if (root.kind === "leaf") return null;
  const firstDepth = findPaneDepth(root.first, paneId);
  if (firstDepth !== null) return firstDepth + 1;
  const secondDepth = findPaneDepth(root.second, paneId);
  return secondDepth === null ? null : secondDepth + 1;
}

export function canSubdividePane(
  root: Pane,
  targetPaneId: PaneId,
  requestedDirection: SplitDirection,
): boolean {
  if (!findLeafPaneById(root, targetPaneId)) return false;
  const targetDepth = findPaneDepth(root, targetPaneId);
  if (targetDepth === null || targetDepth >= 2) return false;
  const parent = findParentSplitNode(root, targetPaneId);
  return !parent || parent.direction !== requestedDirection;
}

export function resolveDefaultFocusLeafId(root: Pane): PaneId {
  return collectLeaves(root)[0]?.id ?? root.id;
}

export function removeLeafByPaneId(
  root: Pane,
  paneId: PaneId,
): { nextRoot: Pane | null; removedLeafIds: PaneId[] } {
  if (root.kind === "leaf") {
    return root.id === paneId
      ? { nextRoot: null, removedLeafIds: [root.id] }
      : { nextRoot: root, removedLeafIds: [] };
  }

  const first = removeLeafByPaneId(root.first, paneId);
  const second = removeLeafByPaneId(root.second, paneId);
  const removedLeafIds = [...first.removedLeafIds, ...second.removedLeafIds];
  if (removedLeafIds.length === 0) return { nextRoot: root, removedLeafIds };
  if (first.nextRoot && second.nextRoot) {
    return {
      nextRoot: { ...root, first: first.nextRoot, second: second.nextRoot },
      removedLeafIds,
    };
  }
  return { nextRoot: first.nextRoot ?? second.nextRoot, removedLeafIds };
}

export function removeLeafByThreadId(
  root: Pane,
  threadId: ThreadId,
): { nextRoot: Pane | null; removedLeafIds: PaneId[] } {
  if (root.kind === "leaf") {
    return root.threadId === threadId
      ? { nextRoot: null, removedLeafIds: [root.id] }
      : { nextRoot: root, removedLeafIds: [] };
  }

  const first = removeLeafByThreadId(root.first, threadId);
  const second = removeLeafByThreadId(root.second, threadId);
  const removedLeafIds = [...first.removedLeafIds, ...second.removedLeafIds];
  if (removedLeafIds.length === 0) return { nextRoot: root, removedLeafIds };
  if (first.nextRoot && second.nextRoot) {
    return {
      nextRoot: { ...root, first: first.nextRoot, second: second.nextRoot },
      removedLeafIds,
    };
  }
  return { nextRoot: first.nextRoot ?? second.nextRoot, removedLeafIds };
}
