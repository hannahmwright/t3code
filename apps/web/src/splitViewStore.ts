import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { randomUUID } from "./lib/utils";
import {
  canSubdividePane,
  collectLeaves,
  findLeafPaneById,
  removeLeafByPaneId,
  removeLeafByThreadId,
  replacePaneInTree,
  resolveDefaultFocusLeafId,
} from "./splitView.logic";

export type SplitViewId = string;
export type PaneId = string;
export type SplitDirection = "horizontal" | "vertical";
export type SplitDropSide = "first" | "second";

export interface LeafPane {
  kind: "leaf";
  id: PaneId;
  threadId: ThreadId | null;
}

export interface SplitNode {
  kind: "split";
  id: PaneId;
  direction: SplitDirection;
  first: Pane;
  second: Pane;
  ratio: number;
}

export type Pane = LeafPane | SplitNode;

export interface SplitView {
  id: SplitViewId;
  sourceThreadId: ThreadId;
  root: Pane;
  focusedPaneId: PaneId;
  createdAt: string;
  updatedAt: string;
}

interface SplitViewStore {
  splitViewsById: Record<SplitViewId, SplitView | undefined>;
  splitViewIdBySourceThreadId: Record<string, SplitViewId | undefined>;
  createFromDrop: (input: {
    sourceThreadId: ThreadId;
    droppedThreadId: ThreadId;
    direction: SplitDirection;
    side: SplitDropSide;
  }) => SplitViewId;
  dropThreadOnPane: (input: {
    splitViewId: SplitViewId;
    targetPaneId: PaneId;
    direction: SplitDirection;
    side: SplitDropSide;
    threadId: ThreadId;
  }) => boolean;
  setFocusedPane: (splitViewId: SplitViewId, paneId: PaneId) => void;
  removePaneFromSplitView: (input: { splitViewId: SplitViewId; paneId: PaneId }) => boolean;
  removeThreadFromSplitViews: (threadId: ThreadId) => void;
}

const SPLIT_VIEW_STORAGE_KEY = "t3code:split-view-state:v1";

function nowIso(): string {
  return new Date().toISOString();
}

function createLeafPane(threadId: ThreadId | null): LeafPane {
  return {
    kind: "leaf",
    id: randomUUID(),
    threadId,
  };
}

function createSplitNode(input: {
  direction: SplitDirection;
  first: Pane;
  second: Pane;
  ratio?: number;
}): SplitNode {
  return {
    kind: "split",
    id: randomUUID(),
    direction: input.direction,
    first: input.first,
    second: input.second,
    ratio: input.ratio ?? 0.5,
  };
}

function buildSplitViewFromDrop(input: {
  sourceThreadId: ThreadId;
  droppedThreadId: ThreadId;
  direction: SplitDirection;
  side: SplitDropSide;
  existing?: Pick<SplitView, "id" | "createdAt"> | null;
}): SplitView {
  const sourceLeaf = createLeafPane(input.sourceThreadId);
  const droppedLeaf = createLeafPane(input.droppedThreadId);
  const root = createSplitNode(
    input.side === "first"
      ? { direction: input.direction, first: droppedLeaf, second: sourceLeaf }
      : { direction: input.direction, first: sourceLeaf, second: droppedLeaf },
  );
  const createdAt = input.existing?.createdAt ?? nowIso();
  return {
    id: input.existing?.id ?? randomUUID(),
    sourceThreadId: input.sourceThreadId,
    root,
    focusedPaneId: droppedLeaf.id,
    createdAt,
    updatedAt: nowIso(),
  };
}

function updateSplitView(
  state: Pick<SplitViewStore, "splitViewsById" | "splitViewIdBySourceThreadId">,
  splitViewId: SplitViewId,
  updater: (splitView: SplitView) => SplitView,
) {
  const existing = state.splitViewsById[splitViewId];
  if (!existing) return state;
  const updated = updater(existing);
  if (updated === existing) return state;
  return {
    ...state,
    splitViewsById: {
      ...state.splitViewsById,
      [splitViewId]: updated,
    },
  };
}

function resolveNextSourceThreadId(root: Pane): ThreadId | null {
  return collectLeaves(root).find((leaf) => leaf.threadId !== null)?.threadId ?? null;
}

export function resolveSplitViewFocusedThreadId(splitView: SplitView): ThreadId | null {
  const focused = findLeafPaneById(splitView.root, splitView.focusedPaneId);
  if (focused?.threadId) return focused.threadId;
  return resolveNextSourceThreadId(splitView.root);
}

export function resolveSplitViewPaneThreadId(
  splitView: SplitView,
  paneId: PaneId,
): ThreadId | null {
  return findLeafPaneById(splitView.root, paneId)?.threadId ?? null;
}

export function resolveSplitViewThreadIds(splitView: SplitView): ThreadId[] {
  return [
    ...new Set(
      collectLeaves(splitView.root)
        .map((leaf) => leaf.threadId)
        .filter((threadId): threadId is ThreadId => threadId !== null),
    ),
  ];
}

export function selectSplitView(splitViewId: SplitViewId | null) {
  return (store: SplitViewStore) =>
    splitViewId ? (store.splitViewsById[splitViewId] ?? null) : null;
}

export const useSplitViewStore = create<SplitViewStore>()(
  persist(
    (set, get) => ({
      splitViewsById: {},
      splitViewIdBySourceThreadId: {},
      createFromDrop: (input) => {
        const existingId = get().splitViewIdBySourceThreadId[input.sourceThreadId] ?? null;
        const existing = existingId ? (get().splitViewsById[existingId] ?? null) : null;
        const splitView = buildSplitViewFromDrop({ ...input, existing });
        set((state) => ({
          splitViewsById: {
            ...state.splitViewsById,
            [splitView.id]: splitView,
          },
          splitViewIdBySourceThreadId: {
            ...state.splitViewIdBySourceThreadId,
            [input.sourceThreadId]: splitView.id,
          },
        }));
        return splitView.id;
      },
      dropThreadOnPane: ({ splitViewId, targetPaneId, direction, side, threadId }) => {
        const splitView = get().splitViewsById[splitViewId];
        if (!splitView) return false;
        const targetLeaf = findLeafPaneById(splitView.root, targetPaneId);
        if (!targetLeaf) return false;
        if (collectLeaves(splitView.root).some((leaf) => leaf.threadId === threadId)) return false;
        if (!canSubdividePane(splitView.root, targetPaneId, direction)) return false;

        const newLeaf = createLeafPane(threadId);
        const newSplit = createSplitNode(
          side === "first"
            ? { direction, first: newLeaf, second: targetLeaf }
            : { direction, first: targetLeaf, second: newLeaf },
        );

        set((state) =>
          updateSplitView(state, splitViewId, (current) => ({
            ...current,
            root: replacePaneInTree(current.root, targetPaneId, newSplit),
            focusedPaneId: newLeaf.id,
            updatedAt: nowIso(),
          })),
        );
        return true;
      },
      setFocusedPane: (splitViewId, paneId) =>
        set((state) =>
          updateSplitView(state, splitViewId, (splitView) => {
            if (splitView.focusedPaneId === paneId || !findLeafPaneById(splitView.root, paneId)) {
              return splitView;
            }
            return { ...splitView, focusedPaneId: paneId, updatedAt: nowIso() };
          }),
        ),
      removePaneFromSplitView: ({ splitViewId, paneId }) => {
        const splitView = get().splitViewsById[splitViewId];
        if (!splitView || !findLeafPaneById(splitView.root, paneId)) return false;
        set((state) => {
          const current = state.splitViewsById[splitViewId];
          if (!current) return state;
          const result = removeLeafByPaneId(current.root, paneId);
          const nextSplitViewsById = { ...state.splitViewsById };
          const nextSplitViewIdBySourceThreadId = { ...state.splitViewIdBySourceThreadId };
          if (!result.nextRoot) {
            delete nextSplitViewsById[splitViewId];
            delete nextSplitViewIdBySourceThreadId[current.sourceThreadId];
            return {
              splitViewsById: nextSplitViewsById,
              splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
            };
          }
          const nextSourceThreadId =
            current.sourceThreadId &&
            collectLeaves(result.nextRoot).some((leaf) => leaf.threadId === current.sourceThreadId)
              ? current.sourceThreadId
              : resolveNextSourceThreadId(result.nextRoot);
          if (!nextSourceThreadId) {
            delete nextSplitViewsById[splitViewId];
            delete nextSplitViewIdBySourceThreadId[current.sourceThreadId];
            return {
              splitViewsById: nextSplitViewsById,
              splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
            };
          }
          if (nextSourceThreadId !== current.sourceThreadId) {
            delete nextSplitViewIdBySourceThreadId[current.sourceThreadId];
            nextSplitViewIdBySourceThreadId[nextSourceThreadId] = splitViewId;
          }
          nextSplitViewsById[splitViewId] = {
            ...current,
            sourceThreadId: nextSourceThreadId,
            root: result.nextRoot,
            focusedPaneId: result.removedLeafIds.includes(current.focusedPaneId)
              ? resolveDefaultFocusLeafId(result.nextRoot)
              : current.focusedPaneId,
            updatedAt: nowIso(),
          };
          return {
            splitViewsById: nextSplitViewsById,
            splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
          };
        });
        return true;
      },
      removeThreadFromSplitViews: (threadId) =>
        set((state) => {
          let changed = false;
          const nextSplitViewsById = { ...state.splitViewsById };
          const nextSplitViewIdBySourceThreadId = { ...state.splitViewIdBySourceThreadId };
          for (const [splitViewId, splitView] of Object.entries(state.splitViewsById)) {
            if (!splitView) continue;
            const result = removeLeafByThreadId(splitView.root, threadId);
            if (result.removedLeafIds.length === 0) continue;
            changed = true;
            if (!result.nextRoot) {
              delete nextSplitViewsById[splitViewId];
              delete nextSplitViewIdBySourceThreadId[splitView.sourceThreadId];
              continue;
            }
            const nextSourceThreadId =
              splitView.sourceThreadId === threadId
                ? resolveNextSourceThreadId(result.nextRoot)
                : splitView.sourceThreadId;
            if (!nextSourceThreadId) {
              delete nextSplitViewsById[splitViewId];
              delete nextSplitViewIdBySourceThreadId[splitView.sourceThreadId];
              continue;
            }
            if (nextSourceThreadId !== splitView.sourceThreadId) {
              delete nextSplitViewIdBySourceThreadId[splitView.sourceThreadId];
              nextSplitViewIdBySourceThreadId[nextSourceThreadId] = splitViewId;
            }
            nextSplitViewsById[splitViewId] = {
              ...splitView,
              sourceThreadId: nextSourceThreadId,
              root: result.nextRoot,
              focusedPaneId: result.removedLeafIds.includes(splitView.focusedPaneId)
                ? resolveDefaultFocusLeafId(result.nextRoot)
                : splitView.focusedPaneId,
              updatedAt: nowIso(),
            };
          }
          return changed
            ? {
                splitViewsById: nextSplitViewsById,
                splitViewIdBySourceThreadId: nextSplitViewIdBySourceThreadId,
              }
            : state;
        }),
    }),
    {
      name: SPLIT_VIEW_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        splitViewsById: state.splitViewsById,
        splitViewIdBySourceThreadId: state.splitViewIdBySourceThreadId,
      }),
    },
  ),
);
