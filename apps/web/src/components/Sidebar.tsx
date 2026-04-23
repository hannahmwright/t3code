import {
  ArchiveIcon,
  ArrowLeftIcon,
  ArrowUpDownIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  GitPullRequestIcon,
  PlusIcon,
  RocketIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { autoAnimate } from "@formkit/auto-animate";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  type DesktopUpdateState,
  ProjectId,
  ThreadId,
  WorkbookId,
  type GitStatusResult,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams } from "@tanstack/react-router";
import {
  type SidebarProjectSortOrder,
  type SidebarThreadSortOrder,
  useAppSettings,
} from "../appSettings";
import { isElectron } from "../env";
import { APP_STAGE_LABEL, APP_VERSION } from "../branding";
import { isTerminalFocused } from "../lib/terminalFocus";
import {
  cn,
  isLinuxPlatform,
  isMacPlatform,
  newCommandId,
  newProjectId,
  newWorkbookId,
} from "../lib/utils";
import { useStore } from "../store";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { derivePendingApprovals, derivePendingUserInputs } from "../session-logic";
import { gitRemoveWorktreeMutationOptions, gitStatusQueryOptions } from "../lib/gitReactQuery";
import { serverConfigQueryOptions } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { toastManager } from "./ui/toast";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateButtonTooltip,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldHighlightDesktopUpdateError,
  shouldShowDesktopUpdateButton,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Collapsible, CollapsibleContent } from "./ui/collapsible";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenuAction,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "./ui/sidebar";
import { useThreadSelectionStore } from "../threadSelectionStore";
import { formatWorktreePathForDisplay, getOrphanedWorktreePathForThread } from "../worktreeCleanup";
import { isNonEmpty as isNonEmptyString } from "effect/String";
import {
  groupProjectsForSidebar,
  getVisibleSidebarThreadIds,
  getVisibleThreadsForProject,
  normalizeWorkbookFields,
  resolveAdjacentThreadId,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
} from "./Sidebar.logic";
import { buildProjectThemeStyle, normalizeProjectAccentColor } from "../projectTheme";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

const EMPTY_KEYBINDINGS: ResolvedKeybindingsConfig = [];
const THREAD_PREVIEW_LIMIT = 6;
const SIDEBAR_EXPANDED_WORKBOOKS_STORAGE_KEY = "t3code:sidebar:expanded-workbooks:v1";
const SIDEBAR_EXPANDED_THREAD_LISTS_STORAGE_KEY = "t3code:sidebar:expanded-thread-lists:v1";
const SIDEBAR_SORT_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const SIDEBAR_THREAD_SORT_LABELS: Record<SidebarThreadSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
};
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;
function isEditableElement(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function readSidebarExpandedIds(storageKey: string): ReadonlySet<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(
      parsed.filter((value): value is string => typeof value === "string" && value.length > 0),
    );
  } catch {
    return new Set();
  }
}

function persistSidebarExpandedIds(storageKey: string, values: ReadonlySet<string>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify([...values]));
  } catch {
    // Ignore storage errors so sidebar interactions stay responsive.
  }
}

interface TerminalStatusIndicator {
  label: "Terminal process running";
  colorClass: string;
  pulse: boolean;
}

interface PrStatusIndicator {
  label: "PR open" | "PR closed" | "PR merged";
  colorClass: string;
  tooltip: string;
  url: string;
}

interface ProjectEditDraft {
  projectId: ProjectId;
  name: string;
  emoji: string;
  color: string;
  workbookId: WorkbookId | null;
  groupName: string;
  groupEmoji: string;
}

interface ProjectGroupEditDraft {
  mode: "create" | "edit";
  workbookId: WorkbookId | null;
  groupName: string;
  groupEmoji: string;
  projectIds: ProjectId[];
}

type ThreadPr = GitStatusResult["pr"];

function terminalStatusFromRunningIds(
  runningTerminalIds: string[],
): TerminalStatusIndicator | null {
  if (runningTerminalIds.length === 0) {
    return null;
  }
  return {
    label: "Terminal process running",
    colorClass: "text-teal-600 dark:text-teal-300/90",
    pulse: true,
  };
}

function prStatusIndicator(pr: ThreadPr): PrStatusIndicator | null {
  if (!pr) return null;

  if (pr.state === "open") {
    return {
      label: "PR open",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      tooltip: `#${pr.number} PR open: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "closed") {
    return {
      label: "PR closed",
      colorClass: "text-zinc-500 dark:text-zinc-400/80",
      tooltip: `#${pr.number} PR closed: ${pr.title}`,
      url: pr.url,
    };
  }
  if (pr.state === "merged") {
    return {
      label: "PR merged",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      tooltip: `#${pr.number} PR merged: ${pr.title}`,
      url: pr.url,
    };
  }
  return null;
}

function T3Wordmark() {
  return (
    <svg
      aria-label="T3"
      className="h-2.5 w-auto shrink-0 text-foreground"
      viewBox="15.5309 37 94.3941 56.96"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z"
        fill="currentColor"
      />
    </svg>
  );
}

type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground" />
          }
        >
          <ArrowUpDownIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">Sort projects</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end" side="bottom" className="min-w-44">
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            Sort projects
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {(Object.entries(SIDEBAR_SORT_LABELS) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            Sort threads
          </div>
          <MenuRadioGroup
            value={threadSortOrder}
            onValueChange={(value) => {
              onThreadSortOrderChange(value as SidebarThreadSortOrder);
            }}
          >
            {(
              Object.entries(SIDEBAR_THREAD_SORT_LABELS) as Array<[SidebarThreadSortOrder, string]>
            ).map(([value, label]) => (
              <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                {label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

function SortableProjectItem({
  projectId,
  disabled = false,
  className,
  children,
}: {
  projectId: ProjectId;
  disabled?: boolean;
  className?: string | undefined;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={cn(
        "group/menu-item relative rounded-md",
        className,
        isDragging ? "z-20 opacity-80" : "",
        isOver && !isDragging ? "ring-1 ring-primary/40" : "",
      )}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

export default function Sidebar() {
  const { isMobile, setOpenMobile } = useSidebar();
  const workbooks = useStore((store) => store.workbooks);
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const markThreadUnread = useStore((store) => store.markThreadUnread);
  const toggleProject = useStore((store) => store.toggleProject);
  const reorderProjects = useStore((store) => store.reorderProjects);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearTerminalState = useTerminalStateStore((state) => state.clearTerminalState);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const clearProjectDraftThreadById = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadById,
  );
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname === "/settings";
  const isOnArchived = pathname === "/archived";
  const { settings: appSettings, updateSettings } = useAppSettings();
  const { handleNewThread } = useHandleNewThread();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeProjectId = useMemo(
    () =>
      routeThreadId
        ? (threads.find((thread) => thread.id === routeThreadId)?.projectId ?? null)
        : null,
    [routeThreadId, threads],
  );
  const { data: keybindings = EMPTY_KEYBINDINGS } = useQuery({
    ...serverConfigQueryOptions(),
    select: (config) => config.keybindings,
  });
  const queryClient = useQueryClient();
  const removeWorktreeMutation = useMutation(gitRemoveWorktreeMutationOptions({ queryClient }));
  const [addingProject, setAddingProject] = useState(false);
  const [newCwd, setNewCwd] = useState("");
  const [newProjectWorkbookId, setNewProjectWorkbookId] = useState<WorkbookId | null>(null);
  const [newProjectGroupName, setNewProjectGroupName] = useState("");
  const [newProjectGroupEmoji, setNewProjectGroupEmoji] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [editingProject, setEditingProject] = useState<ProjectEditDraft | null>(null);
  const [isSavingProjectEdit, setIsSavingProjectEdit] = useState(false);
  const [editingProjectGroup, setEditingProjectGroup] = useState<ProjectGroupEditDraft | null>(
    null,
  );
  const [isSavingProjectGroupEdit, setIsSavingProjectGroupEdit] = useState(false);
  const [expandedWorkbookKeys, setExpandedWorkbookKeys] = useState<ReadonlySet<string>>(() =>
    readSidebarExpandedIds(SIDEBAR_EXPANDED_WORKBOOKS_STORAGE_KEY),
  );
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(
    () =>
      readSidebarExpandedIds(SIDEBAR_EXPANDED_THREAD_LISTS_STORAGE_KEY) as ReadonlySet<ProjectId>,
  );
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const selectedThreadIds = useThreadSelectionStore((s) => s.selectedThreadIds);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform);
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop;
  const shouldShowProjectPathEntry = addingProject && !shouldBrowseForProjectImmediately;
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const threadGitTargets = useMemo(
    () =>
      threads.map((thread) => ({
        threadId: thread.id,
        branch: thread.branch,
        cwd: thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null,
      })),
    [projectCwdById, threads],
  );
  const threadGitStatusCwds = useMemo(
    () => [
      ...new Set(
        threadGitTargets
          .filter((target) => target.branch !== null)
          .map((target) => target.cwd)
          .filter((cwd): cwd is string => cwd !== null),
      ),
    ],
    [threadGitTargets],
  );
  const threadGitStatusQueries = useQueries({
    queries: threadGitStatusCwds.map((cwd) => ({
      ...gitStatusQueryOptions(cwd),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const prByThreadId = useMemo(() => {
    const statusByCwd = new Map<string, GitStatusResult>();
    for (let index = 0; index < threadGitStatusCwds.length; index += 1) {
      const cwd = threadGitStatusCwds[index];
      if (!cwd) continue;
      const status = threadGitStatusQueries[index]?.data;
      if (status) {
        statusByCwd.set(cwd, status);
      }
    }

    const map = new Map<ThreadId, ThreadPr>();
    for (const target of threadGitTargets) {
      const status = target.cwd ? statusByCwd.get(target.cwd) : undefined;
      const branchMatches =
        target.branch !== null && status?.branch !== null && status?.branch === target.branch;
      map.set(target.threadId, branchMatches ? (status?.pr ?? null) : null);
    }
    return map;
  }, [threadGitStatusCwds, threadGitStatusQueries, threadGitTargets]);
  const workbookSuggestions = useMemo(
    () =>
      workbooks
        .map((workbook) => ({
          id: workbook.id,
          name: workbook.name,
          emoji: workbook.emoji ?? "",
        }))
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    [workbooks],
  );
  const workbookById = useMemo(
    () => new Map(workbooks.map((workbook) => [workbook.id, workbook] as const)),
    [workbooks],
  );
  const workbookByLowerName = useMemo(
    () =>
      new Map(
        workbookSuggestions.map(
          (workbook) => [workbook.name.trim().toLowerCase(), workbook] as const,
        ),
      ),
    [workbookSuggestions],
  );
  const workbookEmojiByName = useMemo(
    () =>
      new Map(
        workbookSuggestions.map((group) => [group.name.trim().toLowerCase(), group.emoji] as const),
      ),
    [workbookSuggestions],
  );

  useEffect(() => {
    persistSidebarExpandedIds(SIDEBAR_EXPANDED_WORKBOOKS_STORAGE_KEY, expandedWorkbookKeys);
  }, [expandedWorkbookKeys]);

  useEffect(() => {
    persistSidebarExpandedIds(
      SIDEBAR_EXPANDED_THREAD_LISTS_STORAGE_KEY,
      expandedThreadListsByProject,
    );
  }, [expandedThreadListsByProject]);

  const openPrLink = useCallback((event: React.MouseEvent<HTMLElement>, prUrl: string) => {
    event.preventDefault();
    event.stopPropagation();

    const api = readNativeApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Link opening is unavailable.",
      });
      return;
    }

    void api.shell.openExternal(prUrl).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open PR link",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, []);

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = sortThreadsForSidebar(
        threads.filter((thread) => thread.projectId === projectId),
        appSettings.sidebarThreadSortOrder,
      )[0];
      if (!latestThread) return;

      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [appSettings.sidebarThreadSortOrder, navigate, threads],
  );
  const resolveWorkbookByName = useCallback(
    (groupName: string) => workbookByLowerName.get(groupName.trim().toLowerCase()) ?? null,
    [workbookByLowerName],
  );
  const ensureWorkbookForFields = useCallback(
    async (input: { workbookId?: WorkbookId | null; groupName: string; groupEmoji: string }) => {
      const normalizedWorkbook = normalizeWorkbookFields({
        groupName: input.groupName,
        groupEmoji: input.groupEmoji,
      });
      if (normalizedWorkbook.groupName === null) {
        return {
          workbookId: null,
          groupName: null,
          groupEmoji: null,
        };
      }

      const existingWorkbook =
        (input.workbookId ? (workbookById.get(input.workbookId) ?? null) : null) ??
        resolveWorkbookByName(normalizedWorkbook.groupName);
      if (existingWorkbook) {
        return {
          workbookId: existingWorkbook.id,
          groupName: existingWorkbook.name,
          groupEmoji: existingWorkbook.emoji ?? null,
        };
      }

      const api = readNativeApi();
      if (!api) {
        throw new Error("The workbook service is unavailable.");
      }
      const workbookId = newWorkbookId();
      const createdAt = new Date().toISOString();
      await api.orchestration.dispatchCommand({
        type: "workbook.create",
        commandId: newCommandId(),
        workbookId,
        name: normalizedWorkbook.groupName,
        ...(normalizedWorkbook.groupEmoji ? { emoji: normalizedWorkbook.groupEmoji } : {}),
        createdAt,
      });
      return {
        workbookId,
        groupName: normalizedWorkbook.groupName,
        groupEmoji: normalizedWorkbook.groupEmoji,
      };
    },
    [resolveWorkbookByName, workbookById],
  );

  const addProjectFromPath = useCallback(
    async (
      rawCwd: string,
      workbookOverride?: {
        workbookId?: WorkbookId | null;
        groupName: string;
        groupEmoji: string;
      },
    ) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setNewProjectWorkbookId(null);
        setNewProjectGroupName("");
        setNewProjectGroupEmoji("");
        setAddProjectError(null);
        setAddingProject(false);
      };

      const existing = projects.find((project) => project.cwd === cwd);
      if (existing) {
        focusMostRecentThreadForProject(existing.id);
        finishAddingProject();
        return;
      }

      const projectId = newProjectId();
      const createdAt = new Date().toISOString();
      const title = cwd.split(/[/\\]/).findLast(isNonEmptyString) ?? cwd;
      try {
        const nextWorkbook = await ensureWorkbookForFields({
          workbookId: workbookOverride?.workbookId ?? newProjectWorkbookId,
          ...(workbookOverride ?? {
            groupName: newProjectGroupName,
            groupEmoji: newProjectGroupEmoji,
          }),
        });
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          workspaceRoot: cwd,
          defaultModel: DEFAULT_MODEL_BY_PROVIDER.codex,
          ...(nextWorkbook.workbookId ? { workbookId: nextWorkbook.workbookId } : {}),
          ...(nextWorkbook.groupName ? { groupName: nextWorkbook.groupName } : {}),
          ...(nextWorkbook.groupEmoji ? { groupEmoji: nextWorkbook.groupEmoji } : {}),
          createdAt,
        });
        await handleNewThread(projectId, {
          envMode: appSettings.defaultThreadEnvMode,
        }).catch(() => undefined);
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "An error occurred while adding the project.";
        setIsAddingProject(false);
        if (shouldBrowseForProjectImmediately) {
          toastManager.add({
            type: "error",
            title: "Failed to add project",
            description,
          });
        } else {
          setAddProjectError(description);
        }
        return;
      }
      finishAddingProject();
    },
    [
      focusMostRecentThreadForProject,
      handleNewThread,
      isAddingProject,
      projects,
      shouldBrowseForProjectImmediately,
      appSettings.defaultThreadEnvMode,
      ensureWorkbookForFields,
      newProjectGroupEmoji,
      newProjectGroupName,
      newProjectWorkbookId,
    ],
  );

  const handleAddProject = () => {
    void addProjectFromPath(newCwd);
  };

  const canAddProject = newCwd.trim().length > 0 && !isAddingProject;
  const syncWorkbookEmojiForName = useCallback(
    (groupName: string, currentEmoji: string): string => {
      if (currentEmoji.trim().length > 0) {
        return currentEmoji;
      }
      return workbookEmojiByName.get(groupName.trim().toLowerCase()) ?? currentEmoji;
    },
    [workbookEmojiByName],
  );

  const handlePickFolder = useCallback(
    async (workbookOverride?: {
      workbookId?: WorkbookId | null;
      groupName: string;
      groupEmoji: string;
    }) => {
      const api = readNativeApi();
      if (!api || isPickingFolder) return;
      setIsPickingFolder(true);
      let pickedPath: string | null = null;
      try {
        pickedPath = await api.dialogs.pickFolder();
      } catch {
        // Ignore picker failures and leave the current thread selection unchanged.
      }
      if (pickedPath) {
        await addProjectFromPath(pickedPath, workbookOverride);
      } else if (!shouldBrowseForProjectImmediately) {
        addProjectInputRef.current?.focus();
      }
      setIsPickingFolder(false);
    },
    [addProjectFromPath, isPickingFolder, shouldBrowseForProjectImmediately],
  );

  const handleStartAddProject = () => {
    setAddProjectError(null);
    if (shouldBrowseForProjectImmediately) {
      void handlePickFolder();
      return;
    }
    setAddingProject((prev) => !prev);
  };

  const openProjectEditor = useCallback(
    (projectId: ProjectId) => {
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) {
        return;
      }

      setEditingProject({
        projectId: project.id,
        name: project.name,
        emoji: project.emoji ?? "",
        color: project.color ?? "",
        workbookId: project.workbookId ?? null,
        groupName: project.groupName ?? "",
        groupEmoji: project.groupEmoji ?? "",
      });
    },
    [projects],
  );

  const openProjectGroupCreator = useCallback(() => {
    setEditingProjectGroup({
      mode: "create",
      workbookId: null,
      groupName: "",
      groupEmoji: "",
      projectIds: activeProjectId ? [activeProjectId] : [],
    });
  }, [activeProjectId]);

  const openProjectGroupEditor = useCallback(
    (workbookId: WorkbookId, projectIds: readonly ProjectId[]) => {
      const workbook = workbookById.get(workbookId);
      const groupedProjects = projectIds
        .map((projectId) => projects.find((entry) => entry.id === projectId))
        .filter((project): project is (typeof projects)[number] => project !== undefined);

      if (!workbook) {
        return;
      }

      setEditingProjectGroup({
        mode: "edit",
        workbookId,
        groupName: workbook.name,
        groupEmoji: workbook.emoji ?? "",
        projectIds: groupedProjects.map((project) => project.id),
      });
    },
    [projects, workbookById],
  );

  const toggleProjectGroupProjectSelection = useCallback((projectId: ProjectId) => {
    setEditingProjectGroup((current) => {
      if (!current) {
        return current;
      }

      const projectIds = current.projectIds.includes(projectId)
        ? current.projectIds.filter((id) => id !== projectId)
        : [...current.projectIds, projectId];

      return {
        ...current,
        projectIds,
      };
    });
  }, []);

  const saveProjectEdit = useCallback(async () => {
    if (!editingProject || isSavingProjectEdit) {
      return;
    }

    const project = projects.find((entry) => entry.id === editingProject.projectId);
    if (!project) {
      setEditingProject(null);
      return;
    }

    const nextName = editingProject.name.trim();
    const nextEmoji = editingProject.emoji.trim();
    const nextColorInput = editingProject.color.trim();
    const nextColor = normalizeProjectAccentColor(nextColorInput);

    if (nextName.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project name cannot be empty",
      });
      return;
    }

    if (nextColorInput.length > 0 && nextColor === null) {
      toastManager.add({
        type: "warning",
        title: "Enter a valid color",
        description: "Use a 3-digit or 6-digit hex color like #4F46E5.",
      });
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    setIsSavingProjectEdit(true);
    try {
      const nextWorkbook = await ensureWorkbookForFields({
        workbookId: editingProject.workbookId,
        groupName: editingProject.groupName,
        groupEmoji: editingProject.groupEmoji,
      });
      const patch: {
        title?: string;
        emoji?: string | null;
        color?: string | null;
        workbookId?: WorkbookId | null;
        groupName?: string | null;
        groupEmoji?: string | null;
      } = {};

      if (nextName !== project.name) {
        patch.title = nextName;
      }
      if (nextEmoji !== (project.emoji ?? "")) {
        patch.emoji = nextEmoji.length > 0 ? nextEmoji : null;
      }
      if (nextColor !== (project.color ?? null)) {
        patch.color = nextColor;
      }
      if (nextWorkbook.workbookId !== (project.workbookId ?? null)) {
        patch.workbookId = nextWorkbook.workbookId;
      }
      if (nextWorkbook.groupName !== (project.groupName ?? null)) {
        patch.groupName = nextWorkbook.groupName;
      }
      if (nextWorkbook.groupEmoji !== (project.groupEmoji ?? null)) {
        patch.groupEmoji = nextWorkbook.groupEmoji;
      }
      if (Object.keys(patch).length === 0) {
        setEditingProject(null);
        return;
      }
      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId: editingProject.projectId,
        ...patch,
      });
      setEditingProject(null);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to update project",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsSavingProjectEdit(false);
    }
  }, [editingProject, ensureWorkbookForFields, isSavingProjectEdit, projects]);

  const saveProjectGroupEdit = useCallback(async () => {
    if (!editingProjectGroup || isSavingProjectGroupEdit) {
      return;
    }

    const nextGroupName = editingProjectGroup.groupName.trim();
    const nextGroupEmoji = editingProjectGroup.groupEmoji.trim();
    if (nextGroupName.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Workbook name cannot be empty",
      });
      return;
    }

    const api = readNativeApi();
    if (!api) {
      return;
    }

    setIsSavingProjectGroupEdit(true);
    try {
      const workbookId =
        editingProjectGroup.mode === "create"
          ? newWorkbookId()
          : (editingProjectGroup.workbookId as WorkbookId);

      if (editingProjectGroup.mode === "create") {
        await api.orchestration.dispatchCommand({
          type: "workbook.create",
          commandId: newCommandId(),
          workbookId,
          name: nextGroupName,
          ...(nextGroupEmoji.length > 0 ? { emoji: nextGroupEmoji } : {}),
          createdAt: new Date().toISOString(),
        });
      } else {
        const workbook = workbookById.get(workbookId);
        if (!workbook) {
          throw new Error("That workbook no longer exists.");
        }
        if (workbook.name !== nextGroupName || (workbook.emoji ?? "") !== nextGroupEmoji) {
          await api.orchestration.dispatchCommand({
            type: "workbook.meta.update",
            commandId: newCommandId(),
            workbookId,
            ...(workbook.name !== nextGroupName ? { name: nextGroupName } : {}),
            ...((workbook.emoji ?? "") !== nextGroupEmoji
              ? { emoji: nextGroupEmoji.length > 0 ? nextGroupEmoji : null }
              : {}),
          });
        }
      }

      const selectedProjectIds = new Set(editingProjectGroup.projectIds);
      const currentWorkbookProjectIds =
        editingProjectGroup.mode === "edit"
          ? new Set(
              projects
                .filter((project) => project.workbookId === workbookId)
                .map((project) => project.id),
            )
          : new Set<ProjectId>();
      const affectedProjectIds = new Set<ProjectId>([
        ...selectedProjectIds,
        ...currentWorkbookProjectIds,
      ]);
      for (const projectId of affectedProjectIds) {
        const shouldBelongToWorkbook = selectedProjectIds.has(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.meta.update",
          commandId: newCommandId(),
          projectId,
          workbookId: shouldBelongToWorkbook ? workbookId : null,
          groupName: shouldBelongToWorkbook ? nextGroupName : null,
          groupEmoji: shouldBelongToWorkbook
            ? nextGroupEmoji.length > 0
              ? nextGroupEmoji
              : null
            : null,
        });
      }

      if (editingProjectGroup.mode === "create" && editingProjectGroup.projectIds.length === 0) {
        const workbookDraft = {
          workbookId,
          groupName: nextGroupName,
          groupEmoji: nextGroupEmoji,
        };
        setNewProjectWorkbookId(workbookId);
        setNewProjectGroupName(nextGroupName);
        setNewProjectGroupEmoji(nextGroupEmoji);
        setAddProjectError(null);
        setEditingProjectGroup(null);
        if (shouldBrowseForProjectImmediately) {
          await handlePickFolder(workbookDraft);
        } else {
          setAddingProject(true);
          requestAnimationFrame(() => {
            addProjectInputRef.current?.focus();
          });
        }
        return;
      }
      setEditingProjectGroup(null);
    } catch (error) {
      toastManager.add({
        type: "error",
        title:
          editingProjectGroup.mode === "create"
            ? "Failed to create workbook"
            : "Failed to update workbook",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsSavingProjectGroupEdit(false);
    }
  }, [
    editingProjectGroup,
    handlePickFolder,
    isSavingProjectGroupEdit,
    projects,
    shouldBrowseForProjectImmediately,
    workbookById,
  ]);

  const clearProjectGroup = useCallback(
    async (workbookId: WorkbookId, groupName: string, projectIds: readonly ProjectId[]) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      const groupedProjects = projectIds
        .map((projectId) => projects.find((entry) => entry.id === projectId))
        .filter((project): project is (typeof projects)[number] => project !== undefined);

      const confirmed = await api.dialogs.confirm(
        projectIds.length === 0
          ? `Delete workbook "${groupName}"?`
          : `Remove workbook grouping for "${groupName}"?`,
      );
      if (!confirmed) {
        return;
      }

      try {
        for (const project of groupedProjects) {
          await api.orchestration.dispatchCommand({
            type: "project.meta.update",
            commandId: newCommandId(),
            projectId: project.id,
            workbookId: null,
            groupName: null,
            groupEmoji: null,
          });
        }
        await api.orchestration.dispatchCommand({
          type: "workbook.delete",
          commandId: newCommandId(),
          workbookId,
        });
        setEditingProjectGroup(null);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to update workbook",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [projects],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const commitRename = useCallback(
    async (threadId: ThreadId, newTitle: string, originalTitle: string) => {
      const finishRename = () => {
        setRenamingThreadId((current) => {
          if (current !== threadId) return current;
          renamingInputRef.current = null;
          return null;
        });
      };

      const trimmed = newTitle.trim();
      if (trimmed.length === 0) {
        toastManager.add({ type: "warning", title: "Thread title cannot be empty" });
        finishRename();
        return;
      }
      if (trimmed === originalTitle) {
        finishRename();
        return;
      }
      const api = readNativeApi();
      if (!api) {
        finishRename();
        return;
      }
      try {
        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId,
          title: trimmed,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to rename thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      finishRename();
    },
    [],
  );

  /**
   * Delete a single thread: stop session, close terminal, dispatch delete,
   * clean up drafts/state, and optionally remove orphaned worktree.
   * Callers handle thread-level confirmation; this still prompts for worktree removal.
   */
  const deleteThread = useCallback(
    async (
      threadId: ThreadId,
      opts: { deletedThreadIds?: ReadonlySet<ThreadId> } = {},
    ): Promise<void> => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const threadProject = projects.find((project) => project.id === thread.projectId);
      // When bulk-deleting, exclude the other threads being deleted so
      // getOrphanedWorktreePathForThread correctly detects that no surviving
      // threads will reference this worktree.
      const deletedIds = opts.deletedThreadIds;
      const survivingThreads =
        deletedIds && deletedIds.size > 0
          ? threads.filter((t) => t.id === threadId || !deletedIds.has(t.id))
          : threads;
      const orphanedWorktreePath = getOrphanedWorktreePathForThread(survivingThreads, threadId);
      const displayWorktreePath = orphanedWorktreePath
        ? formatWorktreePathForDisplay(orphanedWorktreePath)
        : null;
      const canDeleteWorktree = orphanedWorktreePath !== null && threadProject !== undefined;
      const shouldDeleteWorktree =
        canDeleteWorktree &&
        (await api.dialogs.confirm(
          [
            "This thread is the only one linked to this worktree:",
            displayWorktreePath ?? orphanedWorktreePath,
            "",
            "Delete the worktree too?",
          ].join("\n"),
        ));

      if (thread.session && thread.session.status !== "closed") {
        await api.orchestration
          .dispatchCommand({
            type: "thread.session.stop",
            commandId: newCommandId(),
            threadId,
            createdAt: new Date().toISOString(),
          })
          .catch(() => undefined);
      }

      try {
        await api.terminal.close({ threadId, deleteHistory: true });
      } catch {
        // Terminal may already be closed
      }

      const allDeletedIds = deletedIds ?? new Set<ThreadId>();
      const shouldNavigateToFallback = routeThreadId === threadId;
      const fallbackThreadId =
        threads.find((entry) => entry.id !== threadId && !allDeletedIds.has(entry.id))?.id ?? null;
      await api.orchestration.dispatchCommand({
        type: "thread.delete",
        commandId: newCommandId(),
        threadId,
      });
      clearComposerDraftForThread(threadId);
      clearProjectDraftThreadById(thread.projectId, thread.id);
      clearTerminalState(threadId);
      if (shouldNavigateToFallback) {
        if (fallbackThreadId) {
          void navigate({
            to: "/$threadId",
            params: { threadId: fallbackThreadId },
            replace: true,
          });
        } else {
          void navigate({ to: "/", replace: true });
        }
      }

      if (!shouldDeleteWorktree || !orphanedWorktreePath || !threadProject) {
        return;
      }

      try {
        await removeWorktreeMutation.mutateAsync({
          cwd: threadProject.cwd,
          path: orphanedWorktreePath,
          force: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing worktree.";
        console.error("Failed to remove orphaned worktree after thread deletion", {
          threadId,
          projectCwd: threadProject.cwd,
          worktreePath: orphanedWorktreePath,
          error,
        });
        toastManager.add({
          type: "error",
          title: "Thread deleted, but worktree removal failed",
          description: `Could not remove ${displayWorktreePath ?? orphanedWorktreePath}. ${message}`,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadById,
      clearTerminalState,
      navigate,
      projects,
      removeWorktreeMutation,
      routeThreadId,
      threads,
    ],
  );

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{ threadId: ThreadId }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Thread ID copied",
        description: ctx.threadId,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy thread ID",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: (ctx) => {
      toastManager.add({
        type: "success",
        title: "Path copied",
        description: ctx.path,
      });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "Failed to copy path",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    },
  });
  const handleThreadContextMenu = useCallback(
    async (threadId: ThreadId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const thread = threads.find((t) => t.id === threadId);
      if (!thread) return;
      const threadWorkspacePath =
        thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null;
      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename thread" },
          { id: "mark-unread", label: "Mark unread" },
          { id: "copy-path", label: "Copy Path" },
          { id: "copy-thread-id", label: "Copy Thread ID" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "rename") {
        setRenamingThreadId(threadId);
        setRenamingTitle(thread.title);
        renamingCommittedRef.current = false;
        return;
      }

      if (clicked === "mark-unread") {
        markThreadUnread(threadId);
        return;
      }
      if (clicked === "copy-path") {
        if (!threadWorkspacePath) {
          toastManager.add({
            type: "error",
            title: "Path unavailable",
            description: "This thread does not have a workspace path to copy.",
          });
          return;
        }
        copyPathToClipboard(threadWorkspacePath, { path: threadWorkspacePath });
        return;
      }
      if (clicked === "copy-thread-id") {
        copyThreadIdToClipboard(threadId, { threadId });
        return;
      }
      if (clicked !== "delete") return;
      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete thread "${thread.title}"?`,
            "This permanently clears conversation history for this thread.",
          ].join("\n"),
        );
        if (!confirmed) {
          return;
        }
      }
      await deleteThread(threadId);
    },
    [
      appSettings.confirmThreadDelete,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      markThreadUnread,
      projectCwdById,
      threads,
    ],
  );

  const handleMultiSelectContextMenu = useCallback(
    async (position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const ids = [...selectedThreadIds];
      if (ids.length === 0) return;
      const count = ids.length;

      const clicked = await api.contextMenu.show(
        [
          { id: "mark-unread", label: `Mark unread (${count})` },
          { id: "delete", label: `Delete (${count})`, destructive: true },
        ],
        position,
      );

      if (clicked === "mark-unread") {
        for (const id of ids) {
          markThreadUnread(id);
        }
        clearSelection();
        return;
      }

      if (clicked !== "delete") return;

      if (appSettings.confirmThreadDelete) {
        const confirmed = await api.dialogs.confirm(
          [
            `Delete ${count} thread${count === 1 ? "" : "s"}?`,
            "This permanently clears conversation history for these threads.",
          ].join("\n"),
        );
        if (!confirmed) return;
      }

      const deletedIds = new Set<ThreadId>(ids);
      for (const id of ids) {
        await deleteThread(id, { deletedThreadIds: deletedIds });
      }
      removeFromSelection(ids);
    },
    [
      appSettings.confirmThreadDelete,
      clearSelection,
      deleteThread,
      markThreadUnread,
      removeFromSelection,
      selectedThreadIds,
    ],
  );

  const navigateToThread = useCallback(
    (threadId: ThreadId) => {
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      if (isMobile) {
        setOpenMobile(false);
      }
      setSelectionAnchor(threadId);
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [clearSelection, isMobile, navigate, selectedThreadIds.size, setOpenMobile, setSelectionAnchor],
  );

  const handleThreadClick = useCallback(
    (event: MouseEvent, threadId: ThreadId, orderedProjectThreadIds: readonly ThreadId[]) => {
      const isMac = isMacPlatform(navigator.platform);
      const isModClick = isMac ? event.metaKey : event.ctrlKey;
      const isShiftClick = event.shiftKey;

      if (isModClick) {
        event.preventDefault();
        toggleThreadSelection(threadId);
        return;
      }

      if (isShiftClick) {
        event.preventDefault();
        rangeSelectTo(threadId, orderedProjectThreadIds);
        return;
      }

      navigateToThread(threadId);
    },
    [navigateToThread, rangeSelectTo, toggleThreadSelection],
  );

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "edit", label: "Edit project" },
          { id: "delete", label: "Remove project", destructive: true },
        ],
        position,
      );
      if (clicked === "edit") {
        openProjectEditor(projectId);
        return;
      }
      if (clicked !== "delete") return;

      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const projectThreads = threads.filter((thread) => thread.projectId === projectId);
      if (projectThreads.length > 0) {
        toastManager.add({
          type: "warning",
          title: "Project is not empty",
          description: "Delete all threads in this project before removing it.",
        });
        return;
      }

      const confirmed = await api.dialogs.confirm(`Remove project "${project.name}"?`);
      if (!confirmed) return;

      try {
        const projectDraftThread = getDraftThreadByProjectId(projectId);
        if (projectDraftThread) {
          clearComposerDraftForThread(projectDraftThread.threadId);
        }
        clearProjectDraftThreadId(projectId);
        await api.orchestration.dispatchCommand({
          type: "project.delete",
          commandId: newCommandId(),
          projectId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error removing project.";
        console.error("Failed to remove project", { projectId, error });
        toastManager.add({
          type: "error",
          title: `Failed to remove "${project.name}"`,
          description: message,
        });
      }
    },
    [
      clearComposerDraftForThread,
      clearProjectDraftThreadId,
      getDraftThreadByProjectId,
      openProjectEditor,
      projects,
      threads,
    ],
  );

  const handleProjectGroupContextMenu = useCallback(
    async (
      workbookId: WorkbookId,
      groupName: string,
      projectIds: readonly ProjectId[],
      position: { x: number; y: number },
    ) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      const clicked = await api.contextMenu.show(
        [
          { id: "edit", label: "Edit workbook" },
          {
            id: "ungroup",
            label: projectIds.length === 0 ? "Delete workbook" : "Ungroup projects",
            destructive: true,
          },
        ],
        position,
      );

      if (clicked === "edit") {
        openProjectGroupEditor(workbookId, projectIds);
        return;
      }

      if (clicked === "ungroup") {
        await clearProjectGroup(workbookId, groupName, projectIds);
      }
    },
    [clearProjectGroup, openProjectGroupEditor],
  );

  const projectDnDSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );
  const projectCollisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return pointerCollisions;
    }

    return closestCorners(args);
  }, []);

  const handleProjectDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        dragInProgressRef.current = false;
        return;
      }
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = projects.find((project) => project.id === active.id);
      const overProject = projects.find((project) => project.id === over.id);
      if (!activeProject || !overProject) return;
      reorderProjects(activeProject.id, overProject.id);
    },
    [appSettings.sidebarProjectSortOrder, projects, reorderProjects],
  );

  const handleProjectDragStart = useCallback(
    (_event: DragStartEvent) => {
      if (appSettings.sidebarProjectSortOrder !== "manual") {
        return;
      }
      dragInProgressRef.current = true;
      suppressProjectClickAfterDragRef.current = true;
    },
    [appSettings.sidebarProjectSortOrder],
  );

  const handleProjectDragCancel = useCallback((_event: DragCancelEvent) => {
    dragInProgressRef.current = false;
  }, []);

  const animatedProjectListsRef = useRef(new WeakSet<HTMLElement>());
  const attachProjectListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedProjectListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedProjectListsRef.current.add(node);
  }, []);

  const animatedThreadListsRef = useRef(new WeakSet<HTMLElement>());
  const attachThreadListAutoAnimateRef = useCallback((node: HTMLElement | null) => {
    if (!node || animatedThreadListsRef.current.has(node)) {
      return;
    }
    autoAnimate(node, SIDEBAR_LIST_ANIMATION_OPTIONS);
    animatedThreadListsRef.current.add(node);
  }, []);

  const handleProjectTitlePointerDownCapture = useCallback(() => {
    suppressProjectClickAfterDragRef.current = false;
  }, []);

  const sortedProjects = useMemo(
    () => sortProjectsForSidebar(projects, threads, appSettings.sidebarProjectSortOrder),
    [appSettings.sidebarProjectSortOrder, projects, threads],
  );
  const groupedProjects = useMemo(
    () => groupProjectsForSidebar({ projects: sortedProjects, workbooks }),
    [sortedProjects, workbooks],
  );
  const isManualProjectSorting = appSettings.sidebarProjectSortOrder === "manual";
  const routeTerminalOpen = routeThreadId
    ? selectThreadTerminalState(terminalStateByThreadId, routeThreadId).terminalOpen
    : false;
  const visibleSidebarThreadIds = useMemo(
    () =>
      getVisibleSidebarThreadIds(
        sortedProjects.map((project) => {
          const projectThreads = sortThreadsForSidebar(
            threads.filter((thread) => thread.projectId === project.id),
            appSettings.sidebarThreadSortOrder,
          );
          const activeThreadId = routeThreadId ?? undefined;
          const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
          const pinnedCollapsedThread =
            !project.expanded && activeThreadId
              ? (projectThreads.find((thread) => thread.id === activeThreadId) ?? null)
              : null;
          const shouldShowThreadPanel = project.expanded || pinnedCollapsedThread !== null;
          const { visibleThreads } = getVisibleThreadsForProject({
            threads: projectThreads,
            activeThreadId,
            isThreadListExpanded,
            previewLimit: THREAD_PREVIEW_LIMIT,
          });

          return {
            shouldShowThreadPanel,
            renderedThreadIds: pinnedCollapsedThread
              ? [pinnedCollapsedThread.id]
              : visibleThreads.map((thread) => thread.id),
          };
        }),
      ),
    [
      appSettings.sidebarThreadSortOrder,
      expandedThreadListsByProject,
      routeThreadId,
      sortedProjects,
      threads,
    ],
  );

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      if (isEditableElement(document.activeElement) || isTerminalFocused()) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: false,
          terminalOpen: routeTerminalOpen,
        },
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadId = resolveAdjacentThreadId({
          threadIds: visibleSidebarThreadIds,
          currentThreadId: routeThreadId,
          direction: traversalDirection,
        });
        if (!targetThreadId) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        navigateToThread(targetThreadId);
        return;
      }

      const jumpIndex = threadJumpIndexFromCommand(command ?? "");
      if (jumpIndex === null) {
        return;
      }

      const targetThreadId = visibleSidebarThreadIds[jumpIndex];
      if (!targetThreadId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(targetThreadId);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [keybindings, navigateToThread, routeTerminalOpen, routeThreadId, visibleSidebarThreadIds]);

  function renderProjectItem(
    project: (typeof sortedProjects)[number],
    dragHandleProps: SortableProjectHandleProps | null,
  ) {
    const projectThreads = sortThreadsForSidebar(
      threads.filter((thread) => thread.projectId === project.id),
      appSettings.sidebarThreadSortOrder,
    );
    const projectStatus = resolveProjectStatusIndicator(
      projectThreads.map((thread) =>
        resolveThreadStatusPill({
          thread,
          hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
          hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
        }),
      ),
    );
    const activeThreadId = routeThreadId ?? undefined;
    const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
    const pinnedCollapsedThread =
      !project.expanded && activeThreadId
        ? (projectThreads.find((thread) => thread.id === activeThreadId) ?? null)
        : null;
    const shouldShowThreadPanel = project.expanded || pinnedCollapsedThread !== null;
    const { hasHiddenThreads, visibleThreads } = getVisibleThreadsForProject({
      threads: projectThreads,
      activeThreadId,
      isThreadListExpanded,
      previewLimit: THREAD_PREVIEW_LIMIT,
    });
    const orderedProjectThreadIds = projectThreads.map((thread) => thread.id);
    const renderedThreads = pinnedCollapsedThread ? [pinnedCollapsedThread] : visibleThreads;
    const renderThreadRow = (thread: (typeof projectThreads)[number]) => {
      const isActive = routeThreadId === thread.id;
      const isSelected = selectedThreadIds.has(thread.id);
      const isHighlighted = isActive || isSelected;
      const projectThemeStyle = buildProjectThemeStyle(project.color ?? null);
      const activeProjectRowStyle =
        isActive && projectThemeStyle
          ? {
              ...projectThemeStyle,
              background:
                "linear-gradient(90deg, var(--project-accent-background-strong), var(--project-accent-background))",
              boxShadow:
                "inset 2px 0 0 var(--project-accent-color), inset 0 0 0 1px var(--project-accent-border)",
              color: "var(--project-accent-text)",
            }
          : undefined;
      const threadStatus = resolveThreadStatusPill({
        thread,
        hasPendingApprovals: derivePendingApprovals(thread.activities).length > 0,
        hasPendingUserInput: derivePendingUserInputs(thread.activities).length > 0,
      });
      const prStatus = prStatusIndicator(prByThreadId.get(thread.id) ?? null);
      const terminalStatus = terminalStatusFromRunningIds(
        selectThreadTerminalState(terminalStateByThreadId, thread.id).runningTerminalIds,
      );

      return (
        <SidebarMenuSubItem key={thread.id} className="w-full" data-thread-item>
          <SidebarMenuSubButton
            render={<div role="button" tabIndex={0} />}
            size="sm"
            isActive={isActive}
            className={resolveThreadRowClassName({
              isActive,
              isSelected,
            })}
            style={activeProjectRowStyle}
            onClick={(event) => {
              handleThreadClick(event, thread.id, orderedProjectThreadIds);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              navigateToThread(thread.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              if (selectedThreadIds.size > 0 && selectedThreadIds.has(thread.id)) {
                void handleMultiSelectContextMenu({
                  x: event.clientX,
                  y: event.clientY,
                });
              } else {
                if (selectedThreadIds.size > 0) {
                  clearSelection();
                }
                void handleThreadContextMenu(thread.id, {
                  x: event.clientX,
                  y: event.clientY,
                });
              }
            }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
              {prStatus && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={prStatus.tooltip}
                        className={`inline-flex items-center justify-center ${prStatus.colorClass} cursor-pointer rounded-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring`}
                        onClick={(event) => {
                          openPrLink(event, prStatus.url);
                        }}
                      >
                        <GitPullRequestIcon className="size-3" />
                      </button>
                    }
                  />
                  <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
                </Tooltip>
              )}
              {threadStatus && (
                <span
                  className={`inline-flex items-center gap-1 text-xs ${threadStatus.colorClass}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${threadStatus.dotClass} ${
                      threadStatus.pulse ? "animate-pulse" : ""
                    }`}
                  />
                  <span className="hidden md:inline">{threadStatus.label}</span>
                </span>
              )}
              {renamingThreadId === thread.id ? (
                <input
                  ref={(el) => {
                    if (el && renamingInputRef.current !== el) {
                      renamingInputRef.current = el;
                      el.focus();
                      el.select();
                    }
                  }}
                  className="min-w-0 flex-1 truncate rounded border border-ring bg-transparent px-1 py-0.5 text-sm outline-none"
                  value={renamingTitle}
                  onChange={(e) => setRenamingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      e.preventDefault();
                      renamingCommittedRef.current = true;
                      void commitRename(thread.id, renamingTitle, thread.title);
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      renamingCommittedRef.current = true;
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    if (!renamingCommittedRef.current) {
                      void commitRename(thread.id, renamingTitle, thread.title);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm">{thread.title}</span>
              )}
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              {terminalStatus && (
                <span
                  role="img"
                  aria-label={terminalStatus.label}
                  title={terminalStatus.label}
                  className={`inline-flex items-center justify-center ${terminalStatus.colorClass}`}
                >
                  <TerminalIcon
                    className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`}
                  />
                </span>
              )}
              <span
                className={`text-xs ${
                  isHighlighted
                    ? "text-foreground/72 dark:text-foreground/82"
                    : "text-muted-foreground/40"
                }`}
              >
                {formatRelativeTime(thread.updatedAt ?? thread.createdAt)}
              </span>
            </div>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      );
    };

    return (
      <Collapsible className="group/collapsible" open={shouldShowThreadPanel}>
        <div className="group/project-header relative">
          <SidebarMenuButton
            ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
            size="sm"
            className={`gap-2.5 px-2.5 py-2 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground ${
              isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
            }`}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
            onPointerDownCapture={handleProjectTitlePointerDownCapture}
            onClick={(event) => handleProjectTitleClick(event, project.id)}
            onKeyDown={(event) => handleProjectTitleKeyDown(event, project.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              void handleProjectContextMenu(project.id, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            {!project.expanded && projectStatus ? (
              <span
                aria-hidden="true"
                title={projectStatus.label}
                className={`-ml-0.5 relative inline-flex size-3.5 shrink-0 items-center justify-center ${projectStatus.colorClass}`}
              >
                <span className="absolute inset-0 flex items-center justify-center transition-opacity duration-150 group-hover/project-header:opacity-0">
                  <span
                    className={`size-[9px] rounded-full ${projectStatus.dotClass} ${
                      projectStatus.pulse ? "animate-pulse" : ""
                    }`}
                  />
                </span>
                <ChevronRightIcon className="absolute inset-0 m-auto size-3.5 text-muted-foreground/70 opacity-0 transition-opacity duration-150 group-hover/project-header:opacity-100" />
              </span>
            ) : (
              <ChevronRightIcon
                className={`-ml-0.5 size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150 ${
                  project.expanded ? "rotate-90" : ""
                }`}
              />
            )}
            {project.emoji ? (
              <span className="shrink-0 text-base leading-none" aria-hidden="true">
                {project.emoji}
              </span>
            ) : null}
            <span className="flex-1 truncate text-sm font-medium text-foreground/90">
              {project.name}
            </span>
          </SidebarMenuButton>
          <Tooltip>
            <TooltipTrigger
              render={
                <SidebarMenuAction
                  render={
                    <button
                      type="button"
                      aria-label={`Create new thread in ${project.name}`}
                      data-testid="new-thread-button"
                    />
                  }
                  showOnHover
                  className="top-1 right-1 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    void handleNewThread(project.id, {
                      envMode: resolveSidebarNewThreadEnvMode({
                        defaultEnvMode: appSettings.defaultThreadEnvMode,
                      }),
                    });
                  }}
                >
                  <SquarePenIcon className="size-3.5" />
                </SidebarMenuAction>
              }
            />
            <TooltipPopup side="top">
              {newThreadShortcutLabel ? `New thread (${newThreadShortcutLabel})` : "New thread"}
            </TooltipPopup>
          </Tooltip>
        </div>

        <CollapsibleContent>
          <SidebarMenuSub
            ref={attachThreadListAutoAnimateRef}
            className="mx-1 my-0 w-full translate-x-0 gap-0.5 px-1.5 py-0"
          >
            {renderedThreads.map((thread) => renderThreadRow(thread))}

            {project.expanded && hasHiddenThreads && !isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  data-thread-selection-safe
                  size="sm"
                  className="h-8 w-full translate-x-0 justify-start px-2.5 text-left text-xs text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                  onClick={() => {
                    expandThreadListForProject(project.id);
                  }}
                >
                  <span>Show more</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
            {project.expanded && hasHiddenThreads && isThreadListExpanded && (
              <SidebarMenuSubItem className="w-full">
                <SidebarMenuSubButton
                  render={<button type="button" />}
                  data-thread-selection-safe
                  size="sm"
                  className="h-8 w-full translate-x-0 justify-start px-2.5 text-left text-xs text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                  onClick={() => {
                    collapseThreadListForProject(project.id);
                  }}
                >
                  <span>Show less</span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            )}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  const handleProjectTitleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (dragInProgressRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (suppressProjectClickAfterDragRef.current) {
        // Consume the synthetic click emitted after a drag release.
        suppressProjectClickAfterDragRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      toggleProject(projectId);
    },
    [clearSelection, selectedThreadIds.size, toggleProject],
  );

  const handleProjectTitleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      if (dragInProgressRef.current) {
        return;
      }
      toggleProject(projectId);
    },
    [toggleProject],
  );

  useEffect(() => {
    const onMouseDown = (event: globalThis.MouseEvent) => {
      if (selectedThreadIds.size === 0) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!shouldClearThreadSelectionOnMouseDown(target)) return;
      clearSelection();
    };

    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [clearSelection, selectedThreadIds.size]);

  useEffect(() => {
    if (!isElectron) return;
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.getUpdateState !== "function" ||
      typeof bridge.onUpdateState !== "function"
    ) {
      return;
    }

    let disposed = false;
    let receivedSubscriptionUpdate = false;
    const unsubscribe = bridge.onUpdateState((nextState) => {
      if (disposed) return;
      receivedSubscriptionUpdate = true;
      setDesktopUpdateState(nextState);
    });

    void bridge
      .getUpdateState()
      .then((nextState) => {
        if (disposed || receivedSubscriptionUpdate) return;
        setDesktopUpdateState(nextState);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  const showDesktopUpdateButton = isElectron && shouldShowDesktopUpdateButton(desktopUpdateState);

  const desktopUpdateTooltip = desktopUpdateState
    ? getDesktopUpdateButtonTooltip(desktopUpdateState)
    : "Update available";

  const desktopUpdateButtonDisabled = isDesktopUpdateButtonDisabled(desktopUpdateState);
  const desktopUpdateButtonAction = desktopUpdateState
    ? resolveDesktopUpdateButtonAction(desktopUpdateState)
    : "none";
  const showArm64IntelBuildWarning =
    isElectron && shouldShowArm64IntelBuildWarning(desktopUpdateState);
  const arm64IntelBuildWarningDescription =
    desktopUpdateState && showArm64IntelBuildWarning
      ? getArm64IntelBuildWarningDescription(desktopUpdateState)
      : null;
  const desktopUpdateButtonInteractivityClasses = desktopUpdateButtonDisabled
    ? "cursor-not-allowed opacity-60"
    : "hover:bg-accent hover:text-foreground";
  const desktopUpdateButtonClasses =
    desktopUpdateState?.status === "downloaded"
      ? "text-emerald-500"
      : desktopUpdateState?.status === "downloading"
        ? "text-sky-400"
        : shouldHighlightDesktopUpdateError(desktopUpdateState)
          ? "text-rose-500 animate-pulse"
          : "text-amber-500 animate-pulse";
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal") ??
    shortcutLabelForCommand(keybindings, "chat.new");
  const projectAccentPickerValue =
    normalizeProjectAccentColor(editingProject?.color ?? "") ?? "#4F46E5";
  const footerIconButtonClassName =
    "h-7 w-7 shrink-0 justify-center gap-0 px-0 py-0 text-muted-foreground/70 hover:bg-accent hover:text-foreground data-[active=true]:bg-accent data-[active=true]:text-foreground";

  const handleDesktopUpdateButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge || !desktopUpdateState) return;
    if (desktopUpdateButtonDisabled || desktopUpdateButtonAction === "none") return;

    if (desktopUpdateButtonAction === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          if (result.completed) {
            toastManager.add({
              type: "success",
              title: "Update downloaded",
              description: "Restart the app from the update button to install it.",
            });
          }
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not start update download",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
      return;
    }

    if (desktopUpdateButtonAction === "install") {
      void bridge
        .installUpdate()
        .then((result) => {
          if (!shouldToastDesktopUpdateActionResult(result)) return;
          const actionError = getDesktopUpdateActionError(result);
          if (!actionError) return;
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: actionError,
          });
        })
        .catch((error) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "An unexpected error occurred.",
          });
        });
    }
  }, [desktopUpdateButtonAction, desktopUpdateButtonDisabled, desktopUpdateState]);

  const expandThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (current.has(projectId)) return current;
      const next = new Set(current);
      next.add(projectId);
      return next;
    });
  }, []);

  const collapseThreadListForProject = useCallback((projectId: ProjectId) => {
    setExpandedThreadListsByProject((current) => {
      if (!current.has(projectId)) return current;
      const next = new Set(current);
      next.delete(projectId);
      return next;
    });
  }, []);

  const toggleWorkbookExpanded = useCallback((workbookKey: string) => {
    setExpandedWorkbookKeys((current) => {
      const next = new Set(current);
      if (next.has(workbookKey)) {
        next.delete(workbookKey);
      } else {
        next.add(workbookKey);
      }
      return next;
    });
  }, []);

  const renderProjectGroupHeader = useCallback(
    (group: (typeof groupedProjects)[number]) => {
      if (!group.name || group.workbookId === null) {
        return null;
      }
      const groupName = group.name;
      const workbookId = group.workbookId;
      const projectIds = group.projects.map((project) => project.id);
      const isExpanded = expandedWorkbookKeys.has(group.key);

      return (
        <SidebarMenuItem className="group/workbook-header relative px-0 pb-1 pt-3">
          <SidebarMenuButton
            size="sm"
            aria-label={`${isExpanded ? "Collapse" : "Expand"} workbook ${groupName}`}
            aria-expanded={isExpanded}
            className="h-8 gap-2 rounded-md px-2.5 text-sm font-medium text-muted-foreground/60 hover:bg-accent/60 hover:text-foreground"
            onClick={() => toggleWorkbookExpanded(group.key)}
            onContextMenu={(event) => {
              event.preventDefault();
              void handleProjectGroupContextMenu(workbookId, groupName, projectIds, {
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            <ChevronRightIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground/70 transition-transform duration-150",
                isExpanded && "rotate-90",
              )}
            />
            {group.emoji ? (
              <span className="shrink-0 text-sm leading-none" aria-hidden="true">
                {group.emoji}
              </span>
            ) : null}
            <span className="truncate">{groupName}</span>
          </SidebarMenuButton>
          <SidebarMenuAction
            aria-label={`Edit workbook ${groupName}`}
            className="text-muted-foreground/60 opacity-0 hover:bg-accent/60 hover:text-foreground group-hover/workbook-header:opacity-100 focus-visible:opacity-100"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openProjectGroupEditor(workbookId, projectIds);
            }}
          >
            <SquarePenIcon className="size-3.5 shrink-0" />
          </SidebarMenuAction>
        </SidebarMenuItem>
      );
    },
    [
      expandedWorkbookKeys,
      handleProjectGroupContextMenu,
      openProjectGroupEditor,
      toggleWorkbookExpanded,
    ],
  );

  const wordmark = (
    <div className="flex items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <div className="flex min-w-0 flex-1 items-center gap-1 ml-1 cursor-pointer">
              <T3Wordmark />
              <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
                Code
              </span>
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </div>
          }
        />
        <TooltipPopup side="bottom" sideOffset={2}>
          Version {APP_VERSION}
        </TooltipPopup>
      </Tooltip>
    </div>
  );

  return (
    <>
      <datalist id="sidebar-workbook-name-options">
        {workbookSuggestions.map((workbook) => (
          <option key={workbook.name} value={workbook.name} />
        ))}
      </datalist>

      {isElectron ? (
        <>
          <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]">
            {wordmark}
            {showDesktopUpdateButton && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={desktopUpdateTooltip}
                      aria-disabled={desktopUpdateButtonDisabled || undefined}
                      disabled={desktopUpdateButtonDisabled}
                      className={`inline-flex size-7 ml-auto mt-1.5 items-center justify-center rounded-md text-muted-foreground transition-colors ${desktopUpdateButtonInteractivityClasses} ${desktopUpdateButtonClasses}`}
                      onClick={handleDesktopUpdateButtonClick}
                    >
                      <RocketIcon className="size-3.5" />
                    </button>
                  }
                />
                <TooltipPopup side="bottom">{desktopUpdateTooltip}</TooltipPopup>
              </Tooltip>
            )}
          </SidebarHeader>
        </>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      <SidebarContent className="gap-0">
        {showArm64IntelBuildWarning && arm64IntelBuildWarningDescription ? (
          <SidebarGroup className="px-2 pt-2 pb-0">
            <Alert variant="warning" className="rounded-2xl border-warning/40 bg-warning/8">
              <TriangleAlertIcon />
              <AlertTitle>Intel build on Apple Silicon</AlertTitle>
              <AlertDescription>{arm64IntelBuildWarningDescription}</AlertDescription>
              {desktopUpdateButtonAction !== "none" ? (
                <AlertAction>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={desktopUpdateButtonDisabled}
                    onClick={handleDesktopUpdateButtonClick}
                  >
                    {desktopUpdateButtonAction === "download"
                      ? "Download ARM build"
                      : "Install ARM build"}
                  </Button>
                </AlertAction>
              ) : null}
            </Alert>
          </SidebarGroup>
        ) : null}
        <SidebarGroup className="px-2 py-2">
          <div className="mb-1 flex items-center justify-between px-2">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
              Projects
            </span>
            <div className="flex items-center gap-1">
              <ProjectSortMenu
                projectSortOrder={appSettings.sidebarProjectSortOrder}
                threadSortOrder={appSettings.sidebarThreadSortOrder}
                onProjectSortOrderChange={(sortOrder) => {
                  updateSettings({ sidebarProjectSortOrder: sortOrder });
                }}
                onThreadSortOrderChange={(sortOrder) => {
                  updateSettings({ sidebarThreadSortOrder: sortOrder });
                }}
              />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="Create workbook"
                      className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={openProjectGroupCreator}
                    />
                  }
                >
                  <FolderPlusIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipPopup side="right">Create workbook</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={shouldShowProjectPathEntry ? "Cancel add project" : "Add project"}
                      aria-pressed={shouldShowProjectPathEntry}
                      className="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={handleStartAddProject}
                    />
                  }
                >
                  <PlusIcon
                    className={`size-3.5 transition-transform duration-150 ${
                      shouldShowProjectPathEntry ? "rotate-45" : "rotate-0"
                    }`}
                  />
                </TooltipTrigger>
                <TooltipPopup side="right">
                  {shouldShowProjectPathEntry ? "Cancel add project" : "Add project"}
                </TooltipPopup>
              </Tooltip>
            </div>
          </div>

          {shouldShowProjectPathEntry && (
            <div className="mb-2 px-1">
              {isElectron && (
                <button
                  type="button"
                  className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => void handlePickFolder()}
                  disabled={isPickingFolder || isAddingProject}
                >
                  <FolderIcon className="size-3.5" />
                  {isPickingFolder ? "Picking folder..." : "Browse for folder"}
                </button>
              )}
              <div className="flex gap-1.5">
                <input
                  ref={addProjectInputRef}
                  className={`min-w-0 flex-1 rounded-md border bg-secondary px-2 py-1 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none ${
                    addProjectError
                      ? "border-red-500/70 focus:border-red-500"
                      : "border-border focus:border-ring"
                  }`}
                  placeholder="/path/to/project"
                  value={newCwd}
                  onChange={(event) => {
                    setNewCwd(event.target.value);
                    setAddProjectError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") handleAddProject();
                    if (event.key === "Escape") {
                      setAddingProject(false);
                      setAddProjectError(null);
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                  onClick={handleAddProject}
                  disabled={!canAddProject}
                >
                  {isAddingProject ? "Adding..." : "Add"}
                </button>
              </div>
              <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_88px]">
                <input
                  className="min-w-0 rounded-md border border-border bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                  placeholder="Workbook name (optional)"
                  value={newProjectGroupName}
                  list="sidebar-workbook-name-options"
                  onChange={(event) => {
                    const nextGroupName = event.target.value;
                    const matchingWorkbook = resolveWorkbookByName(nextGroupName);
                    setNewProjectWorkbookId(matchingWorkbook?.id ?? null);
                    setNewProjectGroupName(nextGroupName);
                    setNewProjectGroupEmoji(
                      (currentEmoji) =>
                        matchingWorkbook?.emoji ??
                        syncWorkbookEmojiForName(nextGroupName, currentEmoji),
                    );
                  }}
                />
                <input
                  className="min-w-0 rounded-md border border-border bg-secondary px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                  placeholder="Emoji"
                  value={newProjectGroupEmoji}
                  onChange={(event) => {
                    setNewProjectGroupEmoji(event.target.value);
                  }}
                />
              </div>
              {addProjectError && (
                <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-400">
                  {addProjectError}
                </p>
              )}
              <div className="mt-1.5 px-0.5">
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                  onClick={() => {
                    setAddingProject(false);
                    setNewProjectWorkbookId(null);
                    setAddProjectError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {isManualProjectSorting ? (
            <DndContext
              sensors={projectDnDSensors}
              collisionDetection={projectCollisionDetection}
              modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
              onDragStart={handleProjectDragStart}
              onDragEnd={handleProjectDragEnd}
              onDragCancel={handleProjectDragCancel}
            >
              <SidebarMenu>
                <SortableContext
                  items={sortedProjects.map((project) => project.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {groupedProjects.map((group) => (
                    <Fragment key={group.key}>
                      {renderProjectGroupHeader(group)}
                      {(group.name === null || expandedWorkbookKeys.has(group.key)) &&
                        group.projects.map((project) => (
                          <SortableProjectItem
                            key={project.id}
                            projectId={project.id}
                            className={group.name ? "ml-3" : undefined}
                          >
                            {(dragHandleProps) => renderProjectItem(project, dragHandleProps)}
                          </SortableProjectItem>
                        ))}
                    </Fragment>
                  ))}
                </SortableContext>
              </SidebarMenu>
            </DndContext>
          ) : (
            <SidebarMenu ref={attachProjectListAutoAnimateRef}>
              {groupedProjects.map((group) => (
                <Fragment key={group.key}>
                  {renderProjectGroupHeader(group)}
                  {(group.name === null || expandedWorkbookKeys.has(group.key)) &&
                    group.projects.map((project) => (
                      <SidebarMenuItem
                        key={project.id}
                        className={cn("rounded-md", group.name ? "ml-3" : undefined)}
                      >
                        {renderProjectItem(project, null)}
                      </SidebarMenuItem>
                    ))}
                </Fragment>
              ))}
            </SidebarMenu>
          )}

          {projects.length === 0 && workbooks.length === 0 && !shouldShowProjectPathEntry && (
            <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
              {threadsHydrated ? "No projects yet" : "Loading workspace..."}
            </div>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-1">
            {isOnSettings || isOnArchived ? (
              <SidebarMenuButton
                size="sm"
                tooltip="Back"
                aria-label="Back"
                className={cn(footerIconButtonClassName, "mr-auto")}
                onClick={() => window.history.back()}
              >
                <ArrowLeftIcon className="size-3.5" />
              </SidebarMenuButton>
            ) : (
              <div className="flex-1" />
            )}
            <div className="ml-auto flex items-center gap-1">
              <SidebarMenuButton
                size="sm"
                tooltip="Archived"
                aria-label="Archived"
                isActive={isOnArchived}
                className={footerIconButtonClassName}
                onClick={() => void navigate({ to: "/archived" })}
              >
                <ArchiveIcon className="size-3.5" />
              </SidebarMenuButton>
              <SidebarMenuButton
                size="sm"
                tooltip="Settings"
                aria-label="Settings"
                isActive={isOnSettings}
                className={footerIconButtonClassName}
                onClick={() => void navigate({ to: "/settings" })}
              >
                <SettingsIcon className="size-3.5" />
              </SidebarMenuButton>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <Dialog
        open={editingProject !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProject(null);
          }
        }}
      >
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>Edit project</DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="sidebar-project-name">Name</FieldLabel>
                <Input
                  id="sidebar-project-name"
                  value={editingProject?.name ?? ""}
                  onChange={(event) =>
                    setEditingProject((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  placeholder="Project name"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="sidebar-project-emoji">Emoji</FieldLabel>
                <Input
                  id="sidebar-project-emoji"
                  value={editingProject?.emoji ?? ""}
                  onChange={(event) =>
                    setEditingProject((current) =>
                      current ? { ...current, emoji: event.target.value } : current,
                    )
                  }
                  placeholder="Optional emoji"
                />
                <FieldDescription>Shown in the sidebar and thread header.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="sidebar-project-color">Accent color</FieldLabel>
                <div className="flex items-center gap-2">
                  <Input
                    id="sidebar-project-color-picker"
                    type="color"
                    aria-label="Project accent color"
                    value={projectAccentPickerValue}
                    onChange={(event) =>
                      setEditingProject((current) =>
                        current ? { ...current, color: event.target.value.toUpperCase() } : current,
                      )
                    }
                    className="h-9 w-12 shrink-0 cursor-pointer p-1 sm:h-8"
                  />
                  <Input
                    id="sidebar-project-color"
                    value={editingProject?.color ?? ""}
                    onChange={(event) =>
                      setEditingProject((current) =>
                        current ? { ...current, color: event.target.value } : current,
                      )
                    }
                    className="min-w-0 flex-1"
                    placeholder="#4F46E5"
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() =>
                      setEditingProject((current) =>
                        current ? { ...current, color: "" } : current,
                      )
                    }
                  >
                    Clear
                  </Button>
                </div>
                <FieldDescription>
                  Pick a color or enter a hex value for active thread highlights.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="sidebar-project-workbook-name">Workbook</FieldLabel>
                <Input
                  id="sidebar-project-workbook-name"
                  value={editingProject?.groupName ?? ""}
                  list="sidebar-workbook-name-options"
                  onChange={(event) =>
                    setEditingProject((current) => {
                      if (!current) {
                        return current;
                      }
                      const matchingWorkbook = resolveWorkbookByName(event.target.value);
                      return {
                        ...current,
                        workbookId: matchingWorkbook?.id ?? null,
                        groupName: event.target.value,
                        groupEmoji:
                          matchingWorkbook?.emoji ??
                          syncWorkbookEmojiForName(event.target.value, current.groupEmoji),
                      };
                    })
                  }
                  placeholder="Optional workbook"
                />
                <FieldDescription>
                  Move this project into another workbook or leave blank. Edit the workbook itself
                  to rename it.
                </FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="sidebar-project-workbook-emoji">Workbook emoji</FieldLabel>
                <Input
                  id="sidebar-project-workbook-emoji"
                  value={editingProject?.groupEmoji ?? ""}
                  onChange={(event) =>
                    setEditingProject((current) =>
                      current ? { ...current, groupEmoji: event.target.value } : current,
                    )
                  }
                  placeholder="Optional workbook emoji"
                />
              </Field>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingProject(null);
                }}
              >
                Cancel
              </Button>
              <Button disabled={isSavingProjectEdit} onClick={() => void saveProjectEdit()}>
                {isSavingProjectEdit ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={editingProjectGroup !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditingProjectGroup(null);
          }
        }}
      >
        <DialogPopup>
          <DialogPanel>
            <DialogHeader>
              <DialogTitle>
                {editingProjectGroup?.mode === "create" ? "Create workbook" : "Edit workbook"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="sidebar-project-group-name">Workbook name</FieldLabel>
                <Input
                  id="sidebar-project-group-name"
                  value={editingProjectGroup?.groupName ?? ""}
                  onChange={(event) =>
                    setEditingProjectGroup((current) =>
                      current ? { ...current, groupName: event.target.value } : current,
                    )
                  }
                  placeholder="Workbook name"
                />
                <FieldDescription>Shown above the projects in this workbook.</FieldDescription>
              </Field>

              <Field>
                <FieldLabel htmlFor="sidebar-project-group-emoji">Workbook emoji</FieldLabel>
                <Input
                  id="sidebar-project-group-emoji"
                  value={editingProjectGroup?.groupEmoji ?? ""}
                  onChange={(event) =>
                    setEditingProjectGroup((current) =>
                      current ? { ...current, groupEmoji: event.target.value } : current,
                    )
                  }
                  placeholder="Optional emoji"
                />
              </Field>

              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>Projects</FieldLabel>
                  <span className="text-[11px] text-muted-foreground/60">
                    {(editingProjectGroup?.projectIds.length ?? 0).toString()} selected
                  </span>
                </div>
                <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-secondary/30 p-2">
                  {sortedProjects.length === 0 ? (
                    <p className="px-2 py-2 text-xs text-muted-foreground/60">
                      Name the workbook, then pick its first project.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {sortedProjects.map((project) => {
                        const isSelected =
                          editingProjectGroup?.projectIds.includes(project.id) ?? false;
                        return (
                          <label
                            key={project.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground/85 transition-colors hover:bg-accent/60"
                          >
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => {
                                toggleProjectGroupProjectSelection(project.id);
                              }}
                            />
                            {project.emoji ? (
                              <span className="shrink-0 text-sm leading-none" aria-hidden="true">
                                {project.emoji}
                              </span>
                            ) : null}
                            <span className="truncate">{project.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
                <FieldDescription>
                  {sortedProjects.length === 0
                    ? "After saving, choose the first project for this workbook."
                    : "Select the projects that belong in this workbook."}
                </FieldDescription>
              </Field>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setEditingProjectGroup(null);
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={isSavingProjectGroupEdit}
                onClick={() => void saveProjectGroupEdit()}
              >
                {isSavingProjectGroupEdit
                  ? editingProjectGroup?.mode === "create"
                    ? "Creating..."
                    : "Saving..."
                  : editingProjectGroup?.mode === "create"
                    ? "Create workbook"
                    : "Save"}
              </Button>
            </DialogFooter>
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </>
  );
}
