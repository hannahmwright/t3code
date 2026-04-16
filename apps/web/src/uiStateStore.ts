import { Debouncer } from "@tanstack/react-pacer";
import { type ProjectId, type ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

const PERSISTED_STATE_KEY = "t3code:ui-state:v1";
const LEGACY_PERSISTED_STATE_KEYS = [
  "t3code:renderer-state:v8",
  "t3code:renderer-state:v7",
  "t3code:renderer-state:v6",
  "t3code:renderer-state:v5",
  "t3code:renderer-state:v4",
  "t3code:renderer-state:v3",
  "codething:renderer-state:v4",
  "codething:renderer-state:v3",
  "codething:renderer-state:v2",
  "codething:renderer-state:v1",
] as const;

interface PersistedUiState {
  expandedProjectCwds?: string[];
  projectOrderCwds?: string[];
  pinnedProjectCwds?: string[];
  collapsedProjectGroups?: string[];
  workspaceDefinitions?: { name: string; emoji?: string | null }[];
  showArchivedThreads?: boolean;
}

export interface UiWorkspaceDefinition {
  name: string;
  emoji: string | null;
}

export interface UiProjectState {
  hasExplicitCollapsedProjectGroupState: boolean;
  hasExplicitProjectExpansionState: boolean;
  projectExpandedById: Record<string, boolean>;
  projectOrder: ProjectId[];
  pinnedProjectIds: ProjectId[];
  collapsedProjectGroups: string[];
  workspaceDefinitions: UiWorkspaceDefinition[];
}

export interface UiThreadState {
  threadLastVisitedAtById: Record<string, string>;
}

export interface UiSidebarPreferencesState {
  showArchivedThreads: boolean;
}

export interface UiState extends UiProjectState, UiThreadState, UiSidebarPreferencesState {}

export interface SyncProjectInput {
  id: ProjectId;
  cwd: string;
}

export interface SyncThreadInput {
  id: ThreadId;
  latestTurnCompletedAt?: string | undefined;
  seedVisitedAt?: string | undefined;
}

const initialState: UiState = {
  hasExplicitCollapsedProjectGroupState: false,
  hasExplicitProjectExpansionState: false,
  projectExpandedById: {},
  projectOrder: [],
  pinnedProjectIds: [],
  collapsedProjectGroups: [],
  workspaceDefinitions: [],
  threadLastVisitedAtById: {},
  showArchivedThreads: false,
};

const persistedExpandedProjectCwds = new Set<string>();
const persistedProjectOrderCwds: string[] = [];
const persistedPinnedProjectCwds: string[] = [];
const currentProjectCwdById = new Map<ProjectId, string>();
const persistedCollapsedProjectGroups = new Set<string>();
const persistedWorkspaceDefinitions: UiWorkspaceDefinition[] = [];
let persistedShowArchivedThreads = false;
let persistedHasExplicitCollapsedProjectGroupState = false;
let persistedHasExplicitProjectExpansionState = false;
let legacyKeysCleanedUp = false;

function readPersistedState(): UiState {
  if (typeof window === "undefined") {
    return initialState;
  }
  try {
    const raw = window.localStorage.getItem(PERSISTED_STATE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        const legacyRaw = window.localStorage.getItem(legacyKey);
        if (!legacyRaw) {
          continue;
        }
        hydratePersistedProjectState(JSON.parse(legacyRaw) as PersistedUiState);
        return {
          ...initialState,
          hasExplicitCollapsedProjectGroupState: persistedHasExplicitCollapsedProjectGroupState,
          hasExplicitProjectExpansionState: persistedHasExplicitProjectExpansionState,
          collapsedProjectGroups: [...persistedCollapsedProjectGroups].toSorted((left, right) =>
            left.localeCompare(right),
          ),
          workspaceDefinitions: [...persistedWorkspaceDefinitions],
          showArchivedThreads: persistedShowArchivedThreads,
        };
      }
      return initialState;
    }
    hydratePersistedProjectState(JSON.parse(raw) as PersistedUiState);
    return {
      ...initialState,
      hasExplicitCollapsedProjectGroupState: persistedHasExplicitCollapsedProjectGroupState,
      hasExplicitProjectExpansionState: persistedHasExplicitProjectExpansionState,
      collapsedProjectGroups: [...persistedCollapsedProjectGroups].toSorted((left, right) =>
        left.localeCompare(right),
      ),
      workspaceDefinitions: [...persistedWorkspaceDefinitions],
      showArchivedThreads: persistedShowArchivedThreads,
    };
  } catch {
    return initialState;
  }
}

function hydratePersistedProjectState(parsed: PersistedUiState): void {
  persistedExpandedProjectCwds.clear();
  persistedProjectOrderCwds.length = 0;
  persistedPinnedProjectCwds.length = 0;
  persistedCollapsedProjectGroups.clear();
  persistedWorkspaceDefinitions.length = 0;
  persistedHasExplicitProjectExpansionState = Object.hasOwn(parsed, "expandedProjectCwds");
  persistedHasExplicitCollapsedProjectGroupState = Object.hasOwn(parsed, "collapsedProjectGroups");
  for (const cwd of parsed.expandedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0) {
      persistedExpandedProjectCwds.add(cwd);
    }
  }
  for (const cwd of parsed.projectOrderCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedProjectOrderCwds.includes(cwd)) {
      persistedProjectOrderCwds.push(cwd);
    }
  }
  for (const cwd of parsed.pinnedProjectCwds ?? []) {
    if (typeof cwd === "string" && cwd.length > 0 && !persistedPinnedProjectCwds.includes(cwd)) {
      persistedPinnedProjectCwds.push(cwd);
    }
  }
  for (const groupName of parsed.collapsedProjectGroups ?? []) {
    if (typeof groupName === "string" && groupName.trim().length > 0) {
      persistedCollapsedProjectGroups.add(groupName.trim());
    }
  }
  for (const workspaceDefinition of parsed.workspaceDefinitions ?? []) {
    if (!workspaceDefinition || typeof workspaceDefinition.name !== "string") {
      continue;
    }
    const name = workspaceDefinition.name.trim();
    if (
      name.length === 0 ||
      persistedWorkspaceDefinitions.some((definition) => definition.name === name)
    ) {
      continue;
    }
    const emoji =
      typeof workspaceDefinition.emoji === "string" && workspaceDefinition.emoji.trim().length > 0
        ? workspaceDefinition.emoji.trim()
        : null;
    persistedWorkspaceDefinitions.push({ name, emoji });
  }
  persistedShowArchivedThreads = parsed.showArchivedThreads === true;
}

function persistState(state: UiState): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const expandedProjectCwds = Object.entries(state.projectExpandedById)
      .filter(([, expanded]) => expanded)
      .flatMap(([projectId]) => {
        const cwd = currentProjectCwdById.get(projectId as ProjectId);
        return cwd ? [cwd] : [];
      });
    const projectOrderCwds = state.projectOrder.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    const pinnedProjectCwds = state.pinnedProjectIds.flatMap((projectId) => {
      const cwd = currentProjectCwdById.get(projectId);
      return cwd ? [cwd] : [];
    });
    window.localStorage.setItem(
      PERSISTED_STATE_KEY,
      JSON.stringify({
        collapsedProjectGroups: state.collapsedProjectGroups,
        expandedProjectCwds,
        pinnedProjectCwds,
        projectOrderCwds,
        workspaceDefinitions: state.workspaceDefinitions,
        showArchivedThreads: state.showArchivedThreads,
      } satisfies PersistedUiState),
    );
    if (!legacyKeysCleanedUp) {
      legacyKeysCleanedUp = true;
      for (const legacyKey of LEGACY_PERSISTED_STATE_KEYS) {
        window.localStorage.removeItem(legacyKey);
      }
    }
  } catch {
    // Ignore quota/storage errors to avoid breaking chat UX.
  }
}

const debouncedPersistState = new Debouncer(persistState, { wait: 500 });

function recordsEqual<T>(left: Record<string, T>, right: Record<string, T>): boolean {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  for (const [key, value] of leftEntries) {
    if (right[key] !== value) {
      return false;
    }
  }
  return true;
}

function projectOrdersEqual(left: readonly ProjectId[], right: readonly ProjectId[]): boolean {
  return (
    left.length === right.length && left.every((projectId, index) => projectId === right[index])
  );
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function workspaceDefinitionsEqual(
  left: readonly UiWorkspaceDefinition[],
  right: readonly UiWorkspaceDefinition[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (definition, index) =>
        definition.name === right[index]?.name && definition.emoji === right[index]?.emoji,
    )
  );
}

export function syncProjects(state: UiState, projects: readonly SyncProjectInput[]): UiState {
  const previousProjectCwdById = new Map(currentProjectCwdById);
  const previousProjectIdByCwd = new Map(
    [...previousProjectCwdById.entries()].map(([projectId, cwd]) => [cwd, projectId] as const),
  );
  currentProjectCwdById.clear();
  for (const project of projects) {
    currentProjectCwdById.set(project.id, project.cwd);
  }
  const cwdMappingChanged =
    previousProjectCwdById.size !== currentProjectCwdById.size ||
    projects.some((project) => previousProjectCwdById.get(project.id) !== project.cwd);

  const nextExpandedById: Record<string, boolean> = {};
  const previousExpandedById = state.projectExpandedById;
  const persistedOrderByCwd = new Map(
    persistedProjectOrderCwds.map((cwd, index) => [cwd, index] as const),
  );
  const nextProjectIdByCwd = new Map(projects.map((project) => [project.cwd, project.id] as const));
  const mappedProjects = projects.map((project, index) => {
    const previousProjectIdForCwd = previousProjectIdByCwd.get(project.cwd);
    const expanded =
      previousExpandedById[project.id] ??
      (previousProjectIdForCwd ? previousExpandedById[previousProjectIdForCwd] : undefined) ??
      (persistedExpandedProjectCwds.size > 0
        ? persistedExpandedProjectCwds.has(project.cwd)
        : true);
    nextExpandedById[project.id] = expanded;
    return {
      id: project.id,
      cwd: project.cwd,
      incomingIndex: index,
    };
  });

  const nextProjectOrder =
    state.projectOrder.length > 0
      ? (() => {
          const nextProjectIdByCwd = new Map(
            mappedProjects.map((project) => [project.cwd, project.id] as const),
          );
          const usedProjectIds = new Set<ProjectId>();
          const orderedProjectIds: ProjectId[] = [];

          for (const projectId of state.projectOrder) {
            const matchedProjectId =
              (projectId in nextExpandedById ? projectId : undefined) ??
              (() => {
                const previousCwd = previousProjectCwdById.get(projectId);
                return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
              })();
            if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
              continue;
            }
            usedProjectIds.add(matchedProjectId);
            orderedProjectIds.push(matchedProjectId);
          }

          for (const project of mappedProjects) {
            if (usedProjectIds.has(project.id)) {
              continue;
            }
            orderedProjectIds.push(project.id);
          }

          return orderedProjectIds;
        })()
      : mappedProjects
          .map((project) => ({
            id: project.id,
            incomingIndex: project.incomingIndex,
            orderIndex:
              persistedOrderByCwd.get(project.cwd) ??
              persistedProjectOrderCwds.length + project.incomingIndex,
          }))
          .toSorted((left, right) => {
            const byOrder = left.orderIndex - right.orderIndex;
            if (byOrder !== 0) {
              return byOrder;
            }
            return left.incomingIndex - right.incomingIndex;
          })
          .map((project) => project.id);

  const nextPinnedProjectIds = (() => {
    const usedProjectIds = new Set<ProjectId>();
    const pinnedProjectIds: ProjectId[] = [];

    for (const projectId of state.pinnedProjectIds) {
      const matchedProjectId =
        (projectId in nextExpandedById ? projectId : undefined) ??
        (() => {
          const previousCwd = previousProjectCwdById.get(projectId);
          return previousCwd ? nextProjectIdByCwd.get(previousCwd) : undefined;
        })();
      if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
        continue;
      }
      usedProjectIds.add(matchedProjectId);
      pinnedProjectIds.push(matchedProjectId);
    }

    for (const cwd of persistedPinnedProjectCwds) {
      const matchedProjectId = nextProjectIdByCwd.get(cwd);
      if (!matchedProjectId || usedProjectIds.has(matchedProjectId)) {
        continue;
      }
      usedProjectIds.add(matchedProjectId);
      pinnedProjectIds.push(matchedProjectId);
    }

    return pinnedProjectIds;
  })();

  if (
    recordsEqual(state.projectExpandedById, nextExpandedById) &&
    projectOrdersEqual(state.projectOrder, nextProjectOrder) &&
    projectOrdersEqual(state.pinnedProjectIds, nextPinnedProjectIds) &&
    !cwdMappingChanged
  ) {
    return state;
  }

  return {
    ...state,
    projectExpandedById: nextExpandedById,
    pinnedProjectIds: nextPinnedProjectIds,
    projectOrder: nextProjectOrder,
  };
}

export function syncThreads(state: UiState, threads: readonly SyncThreadInput[]): UiState {
  const retainedThreadIds = new Set(threads.map((thread) => thread.id));
  const nextThreadLastVisitedAtById = Object.fromEntries(
    Object.entries(state.threadLastVisitedAtById).filter(([threadId]) =>
      retainedThreadIds.has(threadId as ThreadId),
    ),
  );
  for (const thread of threads) {
    const initialVisitedAt = thread.latestTurnCompletedAt ?? thread.seedVisitedAt;
    const previousVisitedAt = nextThreadLastVisitedAtById[thread.id];
    if (
      previousVisitedAt === undefined &&
      initialVisitedAt !== undefined &&
      initialVisitedAt.length > 0
    ) {
      nextThreadLastVisitedAtById[thread.id] = initialVisitedAt;
      continue;
    }

    if (
      previousVisitedAt !== undefined &&
      thread.latestTurnCompletedAt !== undefined &&
      thread.seedVisitedAt !== undefined &&
      previousVisitedAt === thread.seedVisitedAt
    ) {
      const latestTurnCompletedAtMs = Date.parse(thread.latestTurnCompletedAt);
      const previousVisitedAtMs = Date.parse(previousVisitedAt);
      if (
        Number.isFinite(latestTurnCompletedAtMs) &&
        Number.isFinite(previousVisitedAtMs) &&
        latestTurnCompletedAtMs > previousVisitedAtMs
      ) {
        nextThreadLastVisitedAtById[thread.id] = thread.latestTurnCompletedAt;
      }
    }
  }
  if (recordsEqual(state.threadLastVisitedAtById, nextThreadLastVisitedAtById)) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
  };
}

export function markThreadVisited(state: UiState, threadId: ThreadId, visitedAt?: string): UiState {
  const at = visitedAt ?? new Date().toISOString();
  const visitedAtMs = Date.parse(at);
  const previousVisitedAt = state.threadLastVisitedAtById[threadId];
  const previousVisitedAtMs = previousVisitedAt ? Date.parse(previousVisitedAt) : NaN;
  if (
    Number.isFinite(previousVisitedAtMs) &&
    Number.isFinite(visitedAtMs) &&
    previousVisitedAtMs >= visitedAtMs
  ) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: at,
    },
  };
}

export function markThreadUnread(
  state: UiState,
  threadId: ThreadId,
  latestTurnCompletedAt: string | null | undefined,
): UiState {
  if (!latestTurnCompletedAt) {
    return state;
  }
  const latestTurnCompletedAtMs = Date.parse(latestTurnCompletedAt);
  if (Number.isNaN(latestTurnCompletedAtMs)) {
    return state;
  }
  const unreadVisitedAt = new Date(latestTurnCompletedAtMs - 1).toISOString();
  if (state.threadLastVisitedAtById[threadId] === unreadVisitedAt) {
    return state;
  }
  return {
    ...state,
    threadLastVisitedAtById: {
      ...state.threadLastVisitedAtById,
      [threadId]: unreadVisitedAt,
    },
  };
}

export function clearThreadUi(state: UiState, threadId: ThreadId): UiState {
  if (!(threadId in state.threadLastVisitedAtById)) {
    return state;
  }
  const nextThreadLastVisitedAtById = { ...state.threadLastVisitedAtById };
  delete nextThreadLastVisitedAtById[threadId];
  return {
    ...state,
    threadLastVisitedAtById: nextThreadLastVisitedAtById,
  };
}

export function toggleProject(state: UiState, projectId: ProjectId): UiState {
  const expanded = state.projectExpandedById[projectId] ?? true;
  return {
    ...state,
    hasExplicitProjectExpansionState: true,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: !expanded,
    },
  };
}

export function setProjectExpanded(
  state: UiState,
  projectId: ProjectId,
  expanded: boolean,
): UiState {
  if ((state.projectExpandedById[projectId] ?? true) === expanded) {
    return state;
  }
  return {
    ...state,
    hasExplicitProjectExpansionState: true,
    projectExpandedById: {
      ...state.projectExpandedById,
      [projectId]: expanded,
    },
  };
}

export function reorderProjects(
  state: UiState,
  draggedProjectId: ProjectId,
  targetProjectId: ProjectId,
): UiState {
  if (draggedProjectId === targetProjectId) {
    return state;
  }
  const draggedIndex = state.projectOrder.findIndex((projectId) => projectId === draggedProjectId);
  const targetIndex = state.projectOrder.findIndex((projectId) => projectId === targetProjectId);
  if (draggedIndex < 0 || targetIndex < 0) {
    return state;
  }
  const projectOrder = [...state.projectOrder];
  const [draggedProject] = projectOrder.splice(draggedIndex, 1);
  if (!draggedProject) {
    return state;
  }
  projectOrder.splice(targetIndex, 0, draggedProject);
  return {
    ...state,
    projectOrder,
  };
}

export function toggleProjectPinned(
  state: UiState,
  projectId: ProjectId,
  pinned?: boolean,
): UiState {
  const isPinned = state.pinnedProjectIds.includes(projectId);
  const nextPinned = pinned ?? !isPinned;
  if (isPinned === nextPinned) {
    return state;
  }

  if (nextPinned) {
    return {
      ...state,
      pinnedProjectIds: [...state.pinnedProjectIds, projectId],
    };
  }

  return {
    ...state,
    pinnedProjectIds: state.pinnedProjectIds.filter((candidate) => candidate !== projectId),
  };
}

export function toggleProjectGroupCollapsed(state: UiState, groupName: string): UiState {
  const normalizedGroupName = groupName.trim();
  if (normalizedGroupName.length === 0) {
    return state;
  }

  const collapsedGroups = new Set(state.collapsedProjectGroups);
  if (collapsedGroups.has(normalizedGroupName)) {
    collapsedGroups.delete(normalizedGroupName);
  } else {
    collapsedGroups.add(normalizedGroupName);
  }

  const nextCollapsedProjectGroups = [...collapsedGroups].toSorted((left, right) =>
    left.localeCompare(right),
  );
  if (stringArraysEqual(state.collapsedProjectGroups, nextCollapsedProjectGroups)) {
    return state;
  }

  return {
    ...state,
    hasExplicitCollapsedProjectGroupState: true,
    collapsedProjectGroups: nextCollapsedProjectGroups,
  };
}

export function seedProjectExpansion(
  state: UiState,
  expandedProjectIds: readonly ProjectId[],
): UiState {
  if (state.hasExplicitProjectExpansionState) {
    return state;
  }

  const expandedProjectIdSet = new Set(expandedProjectIds);
  const nextExpandedById = Object.fromEntries(
    [...currentProjectCwdById.keys()].map((projectId) => [
      projectId,
      expandedProjectIdSet.has(projectId),
    ]),
  );

  if (recordsEqual(state.projectExpandedById, nextExpandedById)) {
    return {
      ...state,
      hasExplicitProjectExpansionState: true,
    };
  }

  return {
    ...state,
    hasExplicitProjectExpansionState: true,
    projectExpandedById: nextExpandedById,
  };
}

export function seedCollapsedProjectGroups(state: UiState, groupNames: readonly string[]): UiState {
  if (state.hasExplicitCollapsedProjectGroupState) {
    return state;
  }

  const nextCollapsedProjectGroups = [
    ...new Set(groupNames.map((groupName) => groupName.trim()).filter(Boolean)),
  ].toSorted((left, right) => left.localeCompare(right));

  if (stringArraysEqual(state.collapsedProjectGroups, nextCollapsedProjectGroups)) {
    return {
      ...state,
      hasExplicitCollapsedProjectGroupState: true,
    };
  }

  return {
    ...state,
    hasExplicitCollapsedProjectGroupState: true,
    collapsedProjectGroups: nextCollapsedProjectGroups,
  };
}

export function setShowArchivedThreads(state: UiState, showArchivedThreads: boolean): UiState {
  if (state.showArchivedThreads === showArchivedThreads) {
    return state;
  }

  return {
    ...state,
    showArchivedThreads,
  };
}

export function addWorkspaceDefinition(state: UiState, definition: UiWorkspaceDefinition): UiState {
  const name = definition.name.trim();
  if (name.length === 0) {
    return state;
  }

  const emoji = definition.emoji?.trim() ? definition.emoji.trim() : null;
  const nextWorkspaceDefinitions = state.workspaceDefinitions.some((entry) => entry.name === name)
    ? state.workspaceDefinitions.map((entry) => (entry.name === name ? { name, emoji } : entry))
    : [...state.workspaceDefinitions, { name, emoji }];

  if (workspaceDefinitionsEqual(state.workspaceDefinitions, nextWorkspaceDefinitions)) {
    return state;
  }

  return {
    ...state,
    workspaceDefinitions: nextWorkspaceDefinitions,
  };
}

export function updateWorkspaceDefinition(
  state: UiState,
  input: {
    currentName: string;
    nextName: string;
    nextEmoji: string | null;
  },
): UiState {
  const currentName = input.currentName.trim();
  const nextName = input.nextName.trim();
  const nextEmoji = input.nextEmoji?.trim() ? input.nextEmoji.trim() : null;
  if (currentName.length === 0) {
    return state;
  }

  if (nextName.length === 0) {
    return removeWorkspaceDefinition(state, currentName);
  }

  const nextWorkspaceDefinitions = state.workspaceDefinitions.some(
    (definition) => definition.name === currentName,
  )
    ? state.workspaceDefinitions.map((definition) =>
        definition.name === currentName ? { name: nextName, emoji: nextEmoji } : definition,
      )
    : [...state.workspaceDefinitions, { name: nextName, emoji: nextEmoji }];
  const dedupedWorkspaceDefinitions: UiWorkspaceDefinition[] = [];
  for (const definition of nextWorkspaceDefinitions) {
    if (dedupedWorkspaceDefinitions.some((entry) => entry.name === definition.name)) {
      continue;
    }
    dedupedWorkspaceDefinitions.push(definition);
  }

  const nextCollapsedProjectGroups = state.collapsedProjectGroups.map((groupName) =>
    groupName === currentName ? nextName : groupName,
  );

  if (
    workspaceDefinitionsEqual(state.workspaceDefinitions, dedupedWorkspaceDefinitions) &&
    stringArraysEqual(state.collapsedProjectGroups, nextCollapsedProjectGroups)
  ) {
    return state;
  }

  return {
    ...state,
    collapsedProjectGroups: [...new Set(nextCollapsedProjectGroups)].toSorted((left, right) =>
      left.localeCompare(right),
    ),
    workspaceDefinitions: dedupedWorkspaceDefinitions,
  };
}

export function removeWorkspaceDefinition(state: UiState, workspaceName: string): UiState {
  const normalizedWorkspaceName = workspaceName.trim();
  if (normalizedWorkspaceName.length === 0) {
    return state;
  }

  const nextWorkspaceDefinitions = state.workspaceDefinitions.filter(
    (definition) => definition.name !== normalizedWorkspaceName,
  );
  const nextCollapsedProjectGroups = state.collapsedProjectGroups.filter(
    (groupName) => groupName !== normalizedWorkspaceName,
  );

  if (
    workspaceDefinitionsEqual(state.workspaceDefinitions, nextWorkspaceDefinitions) &&
    stringArraysEqual(state.collapsedProjectGroups, nextCollapsedProjectGroups)
  ) {
    return state;
  }

  return {
    ...state,
    collapsedProjectGroups: nextCollapsedProjectGroups,
    workspaceDefinitions: nextWorkspaceDefinitions,
  };
}

interface UiStateStore extends UiState {
  syncProjects: (projects: readonly SyncProjectInput[]) => void;
  syncThreads: (threads: readonly SyncThreadInput[]) => void;
  markThreadVisited: (threadId: ThreadId, visitedAt?: string) => void;
  markThreadUnread: (threadId: ThreadId, latestTurnCompletedAt: string | null | undefined) => void;
  clearThreadUi: (threadId: ThreadId) => void;
  toggleProject: (projectId: ProjectId) => void;
  setProjectExpanded: (projectId: ProjectId, expanded: boolean) => void;
  reorderProjects: (draggedProjectId: ProjectId, targetProjectId: ProjectId) => void;
  toggleProjectPinned: (projectId: ProjectId, pinned?: boolean) => void;
  toggleProjectGroupCollapsed: (groupName: string) => void;
  seedProjectExpansion: (expandedProjectIds: readonly ProjectId[]) => void;
  seedCollapsedProjectGroups: (groupNames: readonly string[]) => void;
  addWorkspaceDefinition: (definition: UiWorkspaceDefinition) => void;
  updateWorkspaceDefinition: (input: {
    currentName: string;
    nextName: string;
    nextEmoji: string | null;
  }) => void;
  removeWorkspaceDefinition: (workspaceName: string) => void;
  setShowArchivedThreads: (showArchivedThreads: boolean) => void;
}

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedState(),
  syncProjects: (projects) => set((state) => syncProjects(state, projects)),
  syncThreads: (threads) => set((state) => syncThreads(state, threads)),
  markThreadVisited: (threadId, visitedAt) =>
    set((state) => markThreadVisited(state, threadId, visitedAt)),
  markThreadUnread: (threadId, latestTurnCompletedAt) =>
    set((state) => markThreadUnread(state, threadId, latestTurnCompletedAt)),
  clearThreadUi: (threadId) => set((state) => clearThreadUi(state, threadId)),
  toggleProject: (projectId) => set((state) => toggleProject(state, projectId)),
  setProjectExpanded: (projectId, expanded) =>
    set((state) => setProjectExpanded(state, projectId, expanded)),
  reorderProjects: (draggedProjectId, targetProjectId) =>
    set((state) => reorderProjects(state, draggedProjectId, targetProjectId)),
  toggleProjectPinned: (projectId, pinned) =>
    set((state) => toggleProjectPinned(state, projectId, pinned)),
  toggleProjectGroupCollapsed: (groupName) =>
    set((state) => toggleProjectGroupCollapsed(state, groupName)),
  seedProjectExpansion: (expandedProjectIds) =>
    set((state) => seedProjectExpansion(state, expandedProjectIds)),
  seedCollapsedProjectGroups: (groupNames) =>
    set((state) => seedCollapsedProjectGroups(state, groupNames)),
  addWorkspaceDefinition: (definition) => set((state) => addWorkspaceDefinition(state, definition)),
  updateWorkspaceDefinition: (input) => set((state) => updateWorkspaceDefinition(state, input)),
  removeWorkspaceDefinition: (workspaceName) =>
    set((state) => removeWorkspaceDefinition(state, workspaceName)),
  setShowArchivedThreads: (showArchivedThreads) =>
    set((state) => setShowArchivedThreads(state, showArchivedThreads)),
}));

useUiStateStore.subscribe((state) => debouncedPersistState.maybeExecute(state));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    debouncedPersistState.flush();
  });
}
