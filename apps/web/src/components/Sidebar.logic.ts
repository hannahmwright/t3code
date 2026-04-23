import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "../appSettings";
import type { Project, Thread, Workbook } from "../types";
import { cn } from "../lib/utils";
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
  isLatestTurnSettled,
} from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";
export type SidebarNewThreadEnvMode = "local" | "worktree";
export type ThreadTraversalDirection = "previous" | "next";
type SidebarProject = {
  id: string;
  name: string;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};
export interface SidebarProjectGroup {
  key: string;
  workbookId: Workbook["id"] | null;
  name: string | null;
  emoji: string | null;
  projects: Project[];
}
export interface SidebarProjectGroupUpdate {
  projectId: Project["id"];
  patch: {
    groupEmoji?: string | null;
    groupName?: string | null;
  };
}

export function normalizeWorkbookFields(input: { groupName: string; groupEmoji: string }): {
  groupName: string | null;
  groupEmoji: string | null;
} {
  const groupName = input.groupName.trim();
  if (groupName.length === 0) {
    return {
      groupName: null,
      groupEmoji: null,
    };
  }

  const groupEmoji = input.groupEmoji.trim();
  return {
    groupName,
    groupEmoji: groupEmoji.length > 0 ? groupEmoji : null,
  };
}

type SidebarThreadSortInput = Pick<Thread, "createdAt" | "updatedAt" | "messages">;

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

const THREAD_STATUS_PRIORITY: Record<ThreadStatusPill["label"], number> = {
  "Pending Approval": 5,
  "Awaiting Input": 4,
  Working: 3,
  Connecting: 3,
  "Plan Ready": 2,
  Completed: 1,
};

type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}

export function resolveSidebarNewThreadEnvMode(input: {
  requestedEnvMode?: SidebarNewThreadEnvMode;
  defaultEnvMode: SidebarNewThreadEnvMode;
}): SidebarNewThreadEnvMode {
  return input.requestedEnvMode ?? input.defaultEnvMode;
}

export function resolveThreadRowClassName(input: {
  isActive: boolean;
  isSelected: boolean;
}): string {
  const baseClassName =
    "h-7 w-full translate-x-0 cursor-pointer justify-start px-2 text-left select-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";

  if (input.isSelected && input.isActive) {
    return cn(
      baseClassName,
      "bg-primary/22 text-foreground font-medium hover:bg-primary/26 hover:text-foreground dark:bg-primary/30 dark:hover:bg-primary/36",
    );
  }

  if (input.isSelected) {
    return cn(
      baseClassName,
      "bg-primary/15 text-foreground hover:bg-primary/19 hover:text-foreground dark:bg-primary/22 dark:hover:bg-primary/28",
    );
  }

  if (input.isActive) {
    return cn(
      baseClassName,
      "bg-accent/85 text-foreground font-medium hover:bg-accent hover:text-foreground dark:bg-accent/55 dark:hover:bg-accent/70",
    );
  }

  return cn(baseClassName, "text-muted-foreground hover:bg-accent hover:text-foreground");
}

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    hasActionableProposedPlan(
      findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null),
    );
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}

export function resolveProjectStatusIndicator(
  statuses: ReadonlyArray<ThreadStatusPill | null>,
): ThreadStatusPill | null {
  let highestPriorityStatus: ThreadStatusPill | null = null;

  for (const status of statuses) {
    if (status === null) continue;
    if (
      highestPriorityStatus === null ||
      THREAD_STATUS_PRIORITY[status.label] > THREAD_STATUS_PRIORITY[highestPriorityStatus.label]
    ) {
      highestPriorityStatus = status;
    }
  }

  return highestPriorityStatus;
}

export function getVisibleThreadsForProject(input: {
  threads: readonly Thread[];
  activeThreadId: Thread["id"] | undefined;
  isThreadListExpanded: boolean;
  previewLimit: number;
}): {
  hasHiddenThreads: boolean;
  visibleThreads: Thread[];
} {
  const { activeThreadId, isThreadListExpanded, previewLimit, threads } = input;
  const hasHiddenThreads = threads.length > previewLimit;

  if (!hasHiddenThreads || isThreadListExpanded) {
    return {
      hasHiddenThreads,
      visibleThreads: [...threads],
    };
  }

  const previewThreads = threads.slice(0, previewLimit);
  if (!activeThreadId || previewThreads.some((thread) => thread.id === activeThreadId)) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  if (!activeThread) {
    return {
      hasHiddenThreads: true,
      visibleThreads: previewThreads,
    };
  }

  const visibleThreadIds = new Set([...previewThreads, activeThread].map((thread) => thread.id));

  return {
    hasHiddenThreads: true,
    visibleThreads: threads.filter((thread) => visibleThreadIds.has(thread.id)),
  };
}

export function getVisibleSidebarThreadIds<TThreadId>(
  renderedProjects: readonly {
    shouldShowThreadPanel?: boolean;
    renderedThreadIds: readonly TThreadId[];
  }[],
): TThreadId[] {
  return renderedProjects.flatMap((renderedProject) =>
    renderedProject.shouldShowThreadPanel === false ? [] : renderedProject.renderedThreadIds,
  );
}

export function resolveAdjacentThreadId<T>(input: {
  threadIds: readonly T[];
  currentThreadId: T | null;
  direction: ThreadTraversalDirection;
}): T | null {
  const { currentThreadId, direction, threadIds } = input;

  if (threadIds.length === 0) {
    return null;
  }

  if (currentThreadId === null) {
    return direction === "previous" ? (threadIds.at(-1) ?? null) : (threadIds[0] ?? null);
  }

  const currentIndex = threadIds.indexOf(currentThreadId);
  if (currentIndex === -1) {
    return null;
  }

  if (direction === "previous") {
    return currentIndex > 0 ? (threadIds[currentIndex - 1] ?? null) : null;
  }

  return currentIndex < threadIds.length - 1 ? (threadIds[currentIndex + 1] ?? null) : null;
}

export function groupProjectsForSidebar(input: {
  projects: readonly Project[];
  workbooks?: readonly Workbook[];
}): SidebarProjectGroup[] {
  const projects = input.projects;
  const workbooks = input.workbooks ?? [];
  const groupedProjects: SidebarProjectGroup[] = [];
  const groupedProjectIndexByWorkbookId = new Map<string, number>();
  const workbookById = new Map(workbooks.map((workbook) => [workbook.id, workbook] as const));
  const seenWorkbookIds = new Set<Workbook["id"]>();

  for (const project of projects) {
    const workbook = project.workbookId ? (workbookById.get(project.workbookId) ?? null) : null;
    const groupName = workbook?.name ?? (project.groupName?.trim() || null);
    const groupEmoji = workbook?.emoji ?? project.groupEmoji ?? null;
    const workbookId = workbook?.id ?? project.workbookId ?? null;

    if (groupName === null || workbookId === null) {
      groupedProjects.push({
        key: `project:${project.id}`,
        workbookId: null,
        name: null,
        emoji: null,
        projects: [project],
      });
      continue;
    }

    seenWorkbookIds.add(workbookId);
    const existingGroupIndex = groupedProjectIndexByWorkbookId.get(workbookId);
    if (existingGroupIndex === undefined) {
      groupedProjectIndexByWorkbookId.set(workbookId, groupedProjects.length);
      groupedProjects.push({
        key: `group:${workbookId}`,
        workbookId,
        name: groupName,
        emoji: groupEmoji,
        projects: [project],
      });
      continue;
    }

    const existingGroup = groupedProjects[existingGroupIndex];
    if (!existingGroup) {
      continue;
    }
    existingGroup.projects.push(project);
    if (existingGroup.emoji === null && groupEmoji) {
      existingGroup.emoji = groupEmoji;
    }
  }

  const emptyWorkbooks = workbooks
    .filter((workbook) => !seenWorkbookIds.has(workbook.id))
    .toSorted((left, right) => {
      const leftTimestamp = Date.parse(left.createdAt ?? "");
      const rightTimestamp = Date.parse(right.createdAt ?? "");
      const leftValue = Number.isNaN(leftTimestamp) ? Number.POSITIVE_INFINITY : leftTimestamp;
      const rightValue = Number.isNaN(rightTimestamp) ? Number.POSITIVE_INFINITY : rightTimestamp;
      if (leftValue !== rightValue) {
        return leftValue - rightValue;
      }
      return left.name.localeCompare(right.name);
    })
    .map((workbook) => ({
      key: `group:${workbook.id}`,
      workbookId: workbook.id,
      name: workbook.name,
      emoji: workbook.emoji,
      projects: [],
    }));

  return [...groupedProjects, ...emptyWorkbooks];
}

export function buildProjectGroupUpdatePlan(input: {
  projects: readonly Pick<Project, "groupEmoji" | "groupName" | "id">[];
  originalGroupName: string | null;
  nextGroupName: string;
  nextGroupEmoji: string;
  selectedProjectIds: readonly Project["id"][];
}): SidebarProjectGroupUpdate[] {
  const normalizedOriginalGroupName = input.originalGroupName?.trim() || null;
  const normalizedNextGroupName = input.nextGroupName.trim();
  const normalizedNextGroupEmoji = input.nextGroupEmoji.trim() || null;
  const selectedProjectIds = new Set(input.selectedProjectIds);

  return input.projects
    .filter((project) => {
      const currentGroupName = project.groupName?.trim() || null;
      return (
        selectedProjectIds.has(project.id) ||
        (normalizedOriginalGroupName !== null && currentGroupName === normalizedOriginalGroupName)
      );
    })
    .map((project) => {
      const currentGroupName = project.groupName?.trim() || null;
      const currentGroupEmoji = project.groupEmoji?.trim() || null;
      const targetGroupName = selectedProjectIds.has(project.id) ? normalizedNextGroupName : null;
      const targetGroupEmoji = selectedProjectIds.has(project.id) ? normalizedNextGroupEmoji : null;
      const patch: SidebarProjectGroupUpdate["patch"] = {};

      if (currentGroupName !== targetGroupName) {
        patch.groupName = targetGroupName;
      }
      if (currentGroupEmoji !== targetGroupEmoji) {
        patch.groupEmoji = targetGroupEmoji;
      }

      return {
        projectId: project.id,
        patch,
      };
    })
    .filter(({ patch }) => Object.keys(patch).length > 0);
}

function toSortableTimestamp(iso: string | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function getLatestUserMessageTimestamp(thread: SidebarThreadSortInput): number {
  let latestUserMessageTimestamp: number | null = null;

  for (const message of thread.messages) {
    if (message.role !== "user") continue;
    const messageTimestamp = toSortableTimestamp(message.createdAt);
    if (messageTimestamp === null) continue;
    latestUserMessageTimestamp =
      latestUserMessageTimestamp === null
        ? messageTimestamp
        : Math.max(latestUserMessageTimestamp, messageTimestamp);
  }

  if (latestUserMessageTimestamp !== null) {
    return latestUserMessageTimestamp;
  }

  return toSortableTimestamp(thread.updatedAt ?? thread.createdAt) ?? Number.NEGATIVE_INFINITY;
}

function getThreadSortTimestamp(
  thread: SidebarThreadSortInput,
  sortOrder: SidebarThreadSortOrder | Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (sortOrder === "created_at") {
    return toSortableTimestamp(thread.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return getLatestUserMessageTimestamp(thread);
}

export function sortThreadsForSidebar<
  T extends Pick<Thread, "id" | "createdAt" | "updatedAt" | "messages">,
>(threads: readonly T[], sortOrder: SidebarThreadSortOrder): T[] {
  return threads.toSorted((left, right) => {
    const rightTimestamp = getThreadSortTimestamp(right, sortOrder);
    const leftTimestamp = getThreadSortTimestamp(left, sortOrder);
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return right.id.localeCompare(left.id);
  });
}

export function getProjectSortTimestamp(
  project: SidebarProject,
  projectThreads: readonly SidebarThreadSortInput[],
  sortOrder: Exclude<SidebarProjectSortOrder, "manual">,
): number {
  if (projectThreads.length > 0) {
    return projectThreads.reduce(
      (latest, thread) => Math.max(latest, getThreadSortTimestamp(thread, sortOrder)),
      Number.NEGATIVE_INFINITY,
    );
  }

  if (sortOrder === "created_at") {
    return toSortableTimestamp(project.createdAt) ?? Number.NEGATIVE_INFINITY;
  }
  return toSortableTimestamp(project.updatedAt ?? project.createdAt) ?? Number.NEGATIVE_INFINITY;
}

export function sortProjectsForSidebar<TProject extends SidebarProject, TThread extends Thread>(
  projects: readonly TProject[],
  threads: readonly TThread[],
  sortOrder: SidebarProjectSortOrder,
): TProject[] {
  if (sortOrder === "manual") {
    return [...projects];
  }

  const threadsByProjectId = new Map<string, TThread[]>();
  for (const thread of threads) {
    const existing = threadsByProjectId.get(thread.projectId) ?? [];
    existing.push(thread);
    threadsByProjectId.set(thread.projectId, existing);
  }

  return [...projects].toSorted((left, right) => {
    const rightTimestamp = getProjectSortTimestamp(
      right,
      threadsByProjectId.get(right.id) ?? [],
      sortOrder,
    );
    const leftTimestamp = getProjectSortTimestamp(
      left,
      threadsByProjectId.get(left.id) ?? [],
      sortOrder,
    );
    const byTimestamp =
      rightTimestamp === leftTimestamp ? 0 : rightTimestamp > leftTimestamp ? 1 : -1;
    if (byTimestamp !== 0) return byTimestamp;
    return left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
  });
}
