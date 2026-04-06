import {
  ArchiveIcon,
  ArchiveXIcon,
  ChevronRightIcon,
  FolderIcon,
  FolderPlusIcon,
  GitPullRequestIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  TerminalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { ProjectFavicon } from "./ProjectFavicon";
import { autoAnimate } from "@formkit/auto-animate";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type MouseEvent,
  type MutableRefObject,
  type PointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  DndContext,
  type DragCancelEvent,
  type CollisionDetection,
  PointerSensor,
  type DragStartEvent,
  closestCorners,
  pointerWithin,
  useDroppable,
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
  type GitStatusResult,
} from "@t3tools/contracts";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { isElectron } from "../env";
import { APP_STAGE_LABEL, APP_VERSION } from "../branding";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isLinuxPlatform, isMacPlatform, newCommandId, newProjectId } from "../lib/utils";
import { useStore } from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminalStateStore";
import { useUiStateStore } from "../uiStateStore";
import {
  resolveShortcutCommand,
  shortcutLabelForCommand,
  shouldShowThreadJumpHints,
  threadJumpCommandForIndex,
  threadJumpIndexFromCommand,
  threadTraversalDirectionFromCommand,
} from "../keybindings";
import { useGitStatus } from "../lib/gitStatusState";
import { readNativeApi } from "../nativeApi";
import { useComposerDraftStore } from "../composerDraftStore";
import { useHandleNewThread } from "../hooks/useHandleNewThread";

import { useThreadActions } from "../hooks/useThreadActions";
import { toastManager } from "./ui/toast";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { SettingsSidebarNav } from "./settings/SettingsSidebarNav";
import {
  getArm64IntelBuildWarningDescription,
  getDesktopUpdateActionError,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
  shouldShowArm64IntelBuildWarning,
  shouldToastDesktopUpdateActionResult,
} from "./desktopUpdate.logic";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
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
import { isNonEmpty as isNonEmptyString } from "effect/String";
import {
  getVisibleSidebarThreadIds,
  getVisibleThreadsForProject,
  groupProjectsForSidebar,
  matchesSidebarThreadSearch,
  normalizeSidebarThreadSearchQuery,
  resolveAdjacentThreadId,
  resolveSidebarThreadSearchMatch,
  isContextMenuPointerDown,
  resolveProjectStatusIndicator,
  resolveSidebarNewThreadSeedContext,
  resolveSidebarNewThreadEnvMode,
  resolveThreadRowClassName,
  resolveThreadStatusPill,
  orderItemsByPreferredIds,
  shouldClearThreadSelectionOnMouseDown,
  sortProjectsForSidebar,
  sortThreadsForSidebar,
  useThreadJumpHintVisibility,
} from "./Sidebar.logic";
import { SidebarUpdatePill } from "./sidebar/SidebarUpdatePill";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useSettings } from "~/hooks/useSettings";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";
import { Field, FieldDescription, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { useServerKeybindings } from "../rpc/serverState";
import { useSidebarThreadSummaryById } from "../storeSelectors";
import type { Project } from "../types";

const THREAD_PREVIEW_LIMIT = 6;
const PROJECT_GROUP_DROP_PREFIX = "sidebar-project-group:";
const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

function groupDropId(groupName: string) {
  return `${PROJECT_GROUP_DROP_PREFIX}${groupName}`;
}

function decodeGroupDropId(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(PROJECT_GROUP_DROP_PREFIX)) {
    return null;
  }

  const groupName = value.slice(PROJECT_GROUP_DROP_PREFIX.length).trim();
  return groupName.length > 0 ? groupName : null;
}

function isEditableElement(target: Element | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function renderHighlightedMatch(
  value: string,
  range: { start: number; end: number } | null,
): ReactNode {
  if (range === null) {
    return value;
  }

  return (
    <>
      {value.slice(0, range.start)}
      <mark className="rounded-sm bg-amber-300/60 px-0.5 text-inherit dark:bg-amber-400/30">
        {value.slice(range.start, range.end)}
      </mark>
      {value.slice(range.end)}
    </>
  );
}

type SidebarProjectSnapshot = Project & {
  expanded: boolean;
};

interface ProjectEditDraft {
  projectId: ProjectId;
  name: string;
  emoji: string;
  groupName: string;
  groupEmoji: string;
}

interface ProjectGroupEditDraft {
  currentName: string;
  nextName: string;
  currentEmoji: string;
  nextEmoji: string;
  projectIds: ProjectId[];
}

interface AddProjectDraft {
  mode: "workspace" | "project";
  groupName: string;
  groupEmoji: string;
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

type ThreadPr = GitStatusResult["pr"];

function ThreadStatusLabel({
  status,
  compact = false,
}: {
  status: NonNullable<ReturnType<typeof resolveThreadStatusPill>>;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <span
        title={status.label}
        className={`inline-flex size-3.5 shrink-0 items-center justify-center ${status.colorClass}`}
      >
        <span
          className={`size-[9px] rounded-full ${status.dotClass} ${
            status.pulse ? "animate-pulse" : ""
          }`}
        />
        <span className="sr-only">{status.label}</span>
      </span>
    );
  }

  return (
    <span
      title={status.label}
      className={`inline-flex items-center gap-1 text-[10px] ${status.colorClass}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${status.dotClass} ${
          status.pulse ? "animate-pulse" : ""
        }`}
      />
      <span className="hidden md:inline">{status.label}</span>
    </span>
  );
}

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

function resolveThreadPr(
  threadBranch: string | null,
  gitStatus: GitStatusResult | null,
): ThreadPr | null {
  if (threadBranch === null || gitStatus === null || gitStatus.branch !== threadBranch) {
    return null;
  }

  return gitStatus.pr ?? null;
}

interface SidebarThreadRowProps {
  threadId: ThreadId;
  projectCwd: string | null;
  orderedProjectThreadIds: readonly ThreadId[];
  routeThreadId: ThreadId | null;
  selectedThreadIds: ReadonlySet<ThreadId>;
  showThreadJumpHints: boolean;
  jumpLabel: string | null;
  searchMatch: ReturnType<typeof resolveSidebarThreadSearchMatch>;
  appSettingsConfirmThreadArchive: boolean;
  renamingThreadId: ThreadId | null;
  renamingTitle: string;
  setRenamingTitle: (title: string) => void;
  renamingInputRef: MutableRefObject<HTMLInputElement | null>;
  renamingCommittedRef: MutableRefObject<boolean>;
  confirmingArchiveThreadId: ThreadId | null;
  setConfirmingArchiveThreadId: Dispatch<SetStateAction<ThreadId | null>>;
  confirmArchiveButtonRefs: MutableRefObject<Map<ThreadId, HTMLButtonElement>>;
  handleThreadClick: (
    event: MouseEvent,
    threadId: ThreadId,
    orderedProjectThreadIds: readonly ThreadId[],
  ) => void;
  navigateToThread: (threadId: ThreadId) => void;
  handleMultiSelectContextMenu: (position: { x: number; y: number }) => Promise<void>;
  handleThreadContextMenu: (
    threadId: ThreadId,
    position: { x: number; y: number },
  ) => Promise<void>;
  clearSelection: () => void;
  commitRename: (threadId: ThreadId, newTitle: string, originalTitle: string) => Promise<void>;
  cancelRename: () => void;
  attemptArchiveThread: (threadId: ThreadId) => Promise<void>;
  openPrLink: (event: MouseEvent<HTMLElement>, prUrl: string) => void;
}

function SidebarThreadRow(props: SidebarThreadRowProps) {
  const thread = useSidebarThreadSummaryById(props.threadId);
  const lastVisitedAt = useUiStateStore((state) => state.threadLastVisitedAtById[props.threadId]);
  const runningTerminalIds = useTerminalStateStore(
    (state) =>
      selectThreadTerminalState(state.terminalStateByThreadId, props.threadId).runningTerminalIds,
  );
  const gitCwd = thread?.worktreePath ?? props.projectCwd;
  const gitStatus = useGitStatus(thread?.branch != null ? gitCwd : null);

  if (!thread) {
    return null;
  }

  const isActive = props.routeThreadId === thread.id;
  const isSelected = props.selectedThreadIds.has(thread.id);
  const isHighlighted = isActive || isSelected;
  const isArchived = thread.archivedAt !== null;
  const isThreadRunning =
    !isArchived && thread.session?.status === "running" && thread.session.activeTurnId != null;
  const threadStatus = resolveThreadStatusPill({
    thread: {
      ...thread,
      lastVisitedAt,
    },
  });
  const pr = resolveThreadPr(thread.branch, gitStatus.data);
  const prStatus = prStatusIndicator(pr);
  const terminalStatus = terminalStatusFromRunningIds(runningTerminalIds);
  const isConfirmingArchive = props.confirmingArchiveThreadId === thread.id && !isThreadRunning;
  const threadMetaClassName = isConfirmingArchive
    ? "pointer-events-none opacity-0"
    : !isThreadRunning
      ? "pointer-events-none transition-opacity duration-150 group-hover/menu-sub-item:opacity-0 group-focus-within/menu-sub-item:opacity-0"
      : "pointer-events-none";

  return (
    <SidebarMenuSubItem
      className="w-full"
      data-thread-item
      onMouseLeave={() => {
        props.setConfirmingArchiveThreadId((current) => (current === thread.id ? null : current));
      }}
      onBlurCapture={(event) => {
        const currentTarget = event.currentTarget;
        requestAnimationFrame(() => {
          if (currentTarget.contains(document.activeElement)) {
            return;
          }
          props.setConfirmingArchiveThreadId((current) => (current === thread.id ? null : current));
        });
      }}
    >
      <SidebarMenuSubButton
        render={<div role="button" tabIndex={0} />}
        size="sm"
        isActive={isActive}
        data-testid={`thread-row-${thread.id}`}
        className={`${resolveThreadRowClassName({
          isActive,
          isSelected,
        })} ${isArchived ? "opacity-80" : ""} relative isolate`}
        onClick={(event) => {
          props.handleThreadClick(event, thread.id, props.orderedProjectThreadIds);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          props.navigateToThread(thread.id);
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          if (props.selectedThreadIds.size > 0 && props.selectedThreadIds.has(thread.id)) {
            void props.handleMultiSelectContextMenu({
              x: event.clientX,
              y: event.clientY,
            });
          } else {
            if (props.selectedThreadIds.size > 0) {
              props.clearSelection();
            }
            void props.handleThreadContextMenu(thread.id, {
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
                      props.openPrLink(event, prStatus.url);
                    }}
                  >
                    <GitPullRequestIcon className="size-3" />
                  </button>
                }
              />
              <TooltipPopup side="top">{prStatus.tooltip}</TooltipPopup>
            </Tooltip>
          )}
          {threadStatus && <ThreadStatusLabel status={threadStatus} />}
          {props.renamingThreadId === thread.id ? (
            <input
              ref={(element) => {
                if (element && props.renamingInputRef.current !== element) {
                  props.renamingInputRef.current = element;
                  element.focus();
                  element.select();
                }
              }}
              className="min-w-0 flex-1 truncate text-xs bg-transparent outline-none border border-ring rounded px-0.5"
              value={props.renamingTitle}
              onChange={(event) => props.setRenamingTitle(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Enter") {
                  event.preventDefault();
                  props.renamingCommittedRef.current = true;
                  void props.commitRename(thread.id, props.renamingTitle, thread.title);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  props.renamingCommittedRef.current = true;
                  props.cancelRename();
                }
              }}
              onBlur={() => {
                if (!props.renamingCommittedRef.current) {
                  void props.commitRename(thread.id, props.renamingTitle, thread.title);
                }
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate text-xs">
                {renderHighlightedMatch(thread.title, props.searchMatch?.titleMatch ?? null)}
              </span>
              {isArchived ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                  Archived
                </span>
              ) : null}
              {props.searchMatch?.matchedInMessages ? (
                <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                  Matched in chat
                </span>
              ) : null}
            </div>
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
              <TerminalIcon className={`size-3 ${terminalStatus.pulse ? "animate-pulse" : ""}`} />
            </span>
          )}
          <div className="flex min-w-12 justify-end">
            {isConfirmingArchive ? (
              <button
                ref={(element) => {
                  if (element) {
                    props.confirmArchiveButtonRefs.current.set(thread.id, element);
                  } else {
                    props.confirmArchiveButtonRefs.current.delete(thread.id);
                  }
                }}
                type="button"
                data-thread-selection-safe
                data-testid={`thread-archive-confirm-${thread.id}`}
                aria-label={`Confirm archive ${thread.title}`}
                className="absolute top-1/2 right-1 inline-flex h-5 -translate-y-1/2 cursor-pointer items-center rounded-full bg-destructive/12 px-2 text-[10px] font-medium text-destructive transition-colors hover:bg-destructive/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-destructive/40"
                onPointerDown={(event) => {
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  props.setConfirmingArchiveThreadId((current) =>
                    current === thread.id ? null : current,
                  );
                  void props.attemptArchiveThread(thread.id);
                }}
              >
                Confirm
              </button>
            ) : !isThreadRunning && !isArchived ? (
              props.appSettingsConfirmThreadArchive ? (
                <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                  <button
                    type="button"
                    data-thread-selection-safe
                    data-testid={`thread-archive-${thread.id}`}
                    aria-label={`Archive ${thread.title}`}
                    className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      props.setConfirmingArchiveThreadId(thread.id);
                      requestAnimationFrame(() => {
                        props.confirmArchiveButtonRefs.current.get(thread.id)?.focus();
                      });
                    }}
                  >
                    <ArchiveIcon className="size-3.5" />
                  </button>
                </div>
              ) : (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <div className="pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 opacity-0 transition-opacity duration-150 group-hover/menu-sub-item:pointer-events-auto group-hover/menu-sub-item:opacity-100 group-focus-within/menu-sub-item:pointer-events-auto group-focus-within/menu-sub-item:opacity-100">
                        <button
                          type="button"
                          data-thread-selection-safe
                          data-testid={`thread-archive-${thread.id}`}
                          aria-label={`Archive ${thread.title}`}
                          className="inline-flex size-5 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            void props.attemptArchiveThread(thread.id);
                          }}
                        >
                          <ArchiveIcon className="size-3.5" />
                        </button>
                      </div>
                    }
                  />
                  <TooltipPopup side="top">Archive</TooltipPopup>
                </Tooltip>
              )
            ) : null}
            <span className={threadMetaClassName}>
              {props.showThreadJumpHints && props.jumpLabel ? (
                <span
                  className="inline-flex h-5 items-center rounded-full border border-border/80 bg-background/90 px-1.5 font-mono text-[10px] font-medium tracking-tight text-foreground shadow-sm"
                  title={props.jumpLabel}
                >
                  {props.jumpLabel}
                </span>
              ) : (
                <span
                  className={`text-[10px] ${
                    isHighlighted
                      ? "text-foreground/72 dark:text-foreground/82"
                      : "text-muted-foreground/40"
                  }`}
                >
                  {isArchived
                    ? `Archived ${formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}`
                    : formatRelativeTimeLabel(thread.updatedAt ?? thread.createdAt)}
                </span>
              )}
            </span>
          </div>
        </div>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
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

function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: ProjectId;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => ReactNode;
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
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

function ProjectGroupHeader({
  collapsed,
  emoji,
  groupName,
  onClick,
  onAddProject,
  onContextMenu,
  manualSorting,
  projectCount,
}: {
  collapsed: boolean;
  emoji: string | null;
  groupName: string;
  onClick: () => void;
  onAddProject?: (() => void) | null;
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  manualSorting: boolean;
  projectCount: number;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: groupDropId(groupName),
    disabled: !manualSorting,
  });

  return (
    <div className="group/project-group relative">
      <button
        ref={setNodeRef}
        type="button"
        className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground ${
          isOver ? "bg-accent text-foreground ring-1 ring-primary/35" : ""
        }`}
        onClick={onClick}
        onContextMenu={onContextMenu}
        title={
          manualSorting ? "Click to collapse. Drop a project here to move it into this folder." : undefined
        }
      >
        <ChevronRightIcon
          className={`size-3 shrink-0 transition-transform duration-150 ${collapsed ? "" : "rotate-90"}`}
        />
        {emoji ? (
          <span className="inline-flex size-3.5 shrink-0 items-center justify-center text-sm leading-none">
            {emoji}
          </span>
        ) : (
          <FolderIcon className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{groupName}</span>
        <span
          className={`ml-auto flex items-center gap-1 transition-opacity duration-150 ${
            onAddProject
              ? "group-hover/project-group:opacity-0 group-focus-within/project-group:opacity-0"
              : ""
          }`}
        >
          <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-muted-foreground/70">
            {projectCount} {projectCount === 1 ? "project" : "projects"}
          </span>
        </span>
      </button>
      {onAddProject ? (
        <div className="pointer-events-none absolute inset-y-0 right-1 flex items-center opacity-0 transition-opacity duration-150 group-hover/project-group:pointer-events-auto group-hover/project-group:opacity-100 group-focus-within/project-group:pointer-events-auto group-focus-within/project-group:opacity-100">
          <button
            type="button"
            aria-label={`Add project to ${groupName}`}
            title={`Add project to ${groupName}`}
            className="inline-flex size-5 items-center justify-center rounded-md text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAddProject();
            }}
          >
            <PlusIcon className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default function Sidebar() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const sidebarThreadsById = useStore((store) => store.sidebarThreadsById);
  const threadIdsByProjectId = useStore((store) => store.threadIdsByProjectId);
  const { open, setOpen } = useSidebar();
  const {
    collapsedProjectGroups,
    pinnedProjectIds,
    projectExpandedById,
    projectOrder,
    showArchivedThreads,
    threadLastVisitedAtById,
  } = useUiStateStore(
    useShallow((store) => ({
      collapsedProjectGroups: store.collapsedProjectGroups,
      pinnedProjectIds: store.pinnedProjectIds,
      projectExpandedById: store.projectExpandedById,
      projectOrder: store.projectOrder,
      showArchivedThreads: store.showArchivedThreads,
      threadLastVisitedAtById: store.threadLastVisitedAtById,
    })),
  );
  const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
  const toggleProject = useUiStateStore((store) => store.toggleProject);
  const toggleProjectGroupCollapsed = useUiStateStore((store) => store.toggleProjectGroupCollapsed);
  const toggleProjectPinned = useUiStateStore((store) => store.toggleProjectPinned);
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const setShowArchivedThreads = useUiStateStore((store) => store.setShowArchivedThreads);
  const clearComposerDraftForThread = useComposerDraftStore((store) => store.clearDraftThread);
  const getDraftThreadByProjectId = useComposerDraftStore(
    (store) => store.getDraftThreadByProjectId,
  );
  const terminalStateByThreadId = useTerminalStateStore((state) => state.terminalStateByThreadId);
  const clearProjectDraftThreadId = useComposerDraftStore(
    (store) => store.clearProjectDraftThreadId,
  );
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const isOnSettings = pathname.startsWith("/settings");
  const appSettings = useSettings();
  const { activeDraftThread, activeThread, handleNewThread } = useHandleNewThread();
  const { archiveThread, deleteThread, unarchiveThread } = useThreadActions();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const keybindings = useServerKeybindings();
  const [addProjectDraft, setAddProjectDraft] = useState<AddProjectDraft | null>(null);
  const [newCwd, setNewCwd] = useState("");
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isAddingProject, setIsAddingProject] = useState(false);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [editingProject, setEditingProject] = useState<ProjectEditDraft | null>(null);
  const [editingProjectGroup, setEditingProjectGroup] = useState<ProjectGroupEditDraft | null>(null);
  const [isSavingProjectEdit, setIsSavingProjectEdit] = useState(false);
  const addProjectInputRef = useRef<HTMLInputElement | null>(null);
  const threadSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<ThreadId | null>(null);
  const [renamingTitle, setRenamingTitle] = useState("");
  const [confirmingArchiveThreadId, setConfirmingArchiveThreadId] = useState<ThreadId | null>(null);
  const [expandedThreadListsByProject, setExpandedThreadListsByProject] = useState<
    ReadonlySet<ProjectId>
  >(() => new Set());
  const { showThreadJumpHints, updateThreadJumpHintsVisibility } = useThreadJumpHintVisibility();
  const renamingCommittedRef = useRef(false);
  const renamingInputRef = useRef<HTMLInputElement | null>(null);
  const confirmArchiveButtonRefs = useRef(new Map<ThreadId, HTMLButtonElement>());
  const dragInProgressRef = useRef(false);
  const suppressProjectClickAfterDragRef = useRef(false);
  const suppressProjectClickForContextMenuRef = useRef(false);
  const [desktopUpdateState, setDesktopUpdateState] = useState<DesktopUpdateState | null>(null);
  const selectedThreadIds = useThreadSelectionStore((s) => s.selectedThreadIds);
  const toggleThreadSelection = useThreadSelectionStore((s) => s.toggleThread);
  const rangeSelectTo = useThreadSelectionStore((s) => s.rangeSelectTo);
  const clearSelection = useThreadSelectionStore((s) => s.clearSelection);
  const removeFromSelection = useThreadSelectionStore((s) => s.removeFromSelection);
  const setSelectionAnchor = useThreadSelectionStore((s) => s.setAnchor);
  const isLinuxDesktop = isElectron && isLinuxPlatform(navigator.platform);
  const platform = navigator.platform;
  const shouldBrowseForProjectImmediately = isElectron && !isLinuxDesktop;
  const shouldShowProjectPathEntry = addProjectDraft !== null;
  const isAddingWorkspace = addProjectDraft?.mode === "workspace";
  const deferredThreadSearchQuery = useDeferredValue(threadSearchQuery);
  const normalizedThreadSearchQuery = useMemo(
    () => normalizeSidebarThreadSearchQuery(deferredThreadSearchQuery),
    [deferredThreadSearchQuery],
  );
  const hasThreadSearch = normalizedThreadSearchQuery.length > 0;
  const collapsedProjectGroupSet = useMemo(
    () => new Set(collapsedProjectGroups),
    [collapsedProjectGroups],
  );
  const pinnedProjectIdSet = useMemo(() => new Set(pinnedProjectIds), [pinnedProjectIds]);
  const archivedThreadCount = useMemo(
    () => threads.filter((thread) => thread.archivedAt !== null).length,
    [threads],
  );
  const orderedProjects = useMemo(() => {
    return orderItemsByPreferredIds({
      items: projects,
      preferredIds: projectOrder,
      getId: (project) => project.id,
    });
  }, [projectOrder, projects]);
  const sidebarProjects = useMemo<SidebarProjectSnapshot[]>(
    () =>
      orderedProjects.map((project) => ({
        ...project,
        expanded: projectExpandedById[project.id] ?? true,
      })),
    [orderedProjects, projectExpandedById],
  );
  const projectCwdById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.cwd] as const)),
    [projects],
  );
  const routeTerminalOpen = routeThreadId
    ? selectThreadTerminalState(terminalStateByThreadId, routeThreadId).terminalOpen
    : false;
  const sidebarShortcutLabelOptions = useMemo(
    () => ({
      platform,
      context: {
        terminalFocus: false,
        terminalOpen: routeTerminalOpen,
      },
    }),
    [platform, routeTerminalOpen],
  );
  const openPrLink = useCallback((event: MouseEvent<HTMLElement>, prUrl: string) => {
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

  const attemptArchiveThread = useCallback(
    async (threadId: ThreadId) => {
      try {
        await archiveThread(threadId);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to archive thread",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [archiveThread],
  );

  const focusMostRecentThreadForProject = useCallback(
    (projectId: ProjectId) => {
      const latestThread = sortThreadsForSidebar(
        (threadIdsByProjectId[projectId] ?? [])
          .map((threadId) => sidebarThreadsById[threadId])
          .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
          .filter((thread) => thread.archivedAt === null),
        appSettings.sidebarThreadSortOrder,
      )[0];
      if (!latestThread) return;

      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
    },
    [appSettings.sidebarThreadSortOrder, navigate, sidebarThreadsById, threadIdsByProjectId],
  );

  const addProjectFromPath = useCallback(
    async (rawCwd: string, targetDraft: AddProjectDraft | null = addProjectDraft) => {
      const cwd = rawCwd.trim();
      if (!cwd || isAddingProject) return;
      const api = readNativeApi();
      if (!api) return;

      setIsAddingProject(true);
      const finishAddingProject = () => {
        setIsAddingProject(false);
        setNewCwd("");
        setAddProjectError(null);
        setAddProjectDraft(null);
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
      const groupName = targetDraft?.groupName.trim() ?? "";
      const groupEmoji = targetDraft?.groupEmoji.trim() ?? "";
      try {
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title,
          ...(groupName.length > 0 ? { groupName } : {}),
          ...(groupName.length > 0 ? { groupEmoji: groupEmoji.length > 0 ? groupEmoji : null } : {}),
          workspaceRoot: cwd,
          defaultModelSelection: {
            provider: "codex",
            model: DEFAULT_MODEL_BY_PROVIDER.codex,
          },
          createdAt,
        });
        await handleNewThread(projectId, {
          envMode: appSettings.defaultThreadEnvMode,
        }).catch(() => undefined);
      } catch (error) {
        const description =
          error instanceof Error ? error.message : "An error occurred while adding the project.";
        setIsAddingProject(false);
        if (addProjectDraft === null) {
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
      addProjectDraft,
      focusMostRecentThreadForProject,
      handleNewThread,
      isAddingProject,
      projects,
      appSettings.defaultThreadEnvMode,
    ],
  );

  const handleAddProject = () => {
    if (addProjectDraft?.mode === "workspace" && addProjectDraft.groupName.trim().length === 0) {
      toastManager.add({
        type: "warning",
        title: "Workspace name cannot be empty",
      });
      return;
    }

    void addProjectFromPath(newCwd, addProjectDraft);
  };

  const canAddProject =
    newCwd.trim().length > 0 &&
    !isAddingProject &&
    (addProjectDraft?.mode !== "workspace" || addProjectDraft.groupName.trim().length > 0);

  const handlePickFolder = async (targetDraft: AddProjectDraft | null = addProjectDraft) => {
    const api = readNativeApi();
    if (!api || isPickingFolder) return;
    if (targetDraft?.mode === "workspace" && targetDraft.groupName.trim().length === 0) {
      toastManager.add({
        type: "warning",
        title: "Workspace name cannot be empty",
      });
      return;
    }
    setIsPickingFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder();
    } catch {
      // Ignore picker failures and leave the current thread selection unchanged.
    }
    if (pickedPath) {
      await addProjectFromPath(pickedPath, targetDraft);
    } else if (targetDraft !== null) {
      addProjectInputRef.current?.focus();
    }
    setIsPickingFolder(false);
  };

  const handleStartAddWorkspace = () => {
    setAddProjectError(null);
    setNewCwd("");
    setAddProjectDraft((current) =>
      current?.mode === "workspace"
        ? null
        : {
            mode: "workspace",
            groupName: "",
            groupEmoji: "",
          },
    );
  };

  const handleStartAddProjectForGroup = useCallback(
    (groupName: string, groupEmoji: string | null) => {
      const targetDraft: AddProjectDraft = {
        mode: "project",
        groupName,
        groupEmoji: groupEmoji ?? "",
      };

      setAddProjectError(null);
      setNewCwd("");
      if (shouldBrowseForProjectImmediately) {
        void handlePickFolder(targetDraft);
        return;
      }

      setAddProjectDraft(targetDraft);
      requestAnimationFrame(() => {
        addProjectInputRef.current?.focus();
      });
    },
    [handlePickFolder, shouldBrowseForProjectImmediately],
  );

  const cancelRename = useCallback(() => {
    setRenamingThreadId(null);
    renamingInputRef.current = null;
  }, []);

  const openProjectEditor = useCallback((project: Project) => {
    setEditingProject({
      projectId: project.id,
      name: project.name,
      emoji: project.emoji ?? "",
      groupName: project.groupName ?? "",
      groupEmoji: project.groupEmoji ?? "",
    });
  }, []);

  const updateProjectMetadata = useCallback(
    async (
      projectId: ProjectId,
      patch: {
        title?: string;
        emoji?: string | null;
        groupName?: string | null;
        groupEmoji?: string | null;
      },
    ) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      await api.orchestration.dispatchCommand({
        type: "project.meta.update",
        commandId: newCommandId(),
        projectId,
        ...patch,
      });
    },
    [],
  );

  const updateProjectsGroupMetadata = useCallback(
    async (
      projectIds: readonly ProjectId[],
      patch: {
        groupName?: string | null;
        groupEmoji?: string | null;
      },
    ) => {
      if (projectIds.length === 0) {
        return;
      }

      for (const projectId of projectIds) {
        await updateProjectMetadata(projectId, patch);
      }
    },
    [updateProjectMetadata],
  );

  const saveProjectEdit = useCallback(async () => {
    if (!editingProject || isSavingProjectEdit) return;

    const project = projects.find((entry) => entry.id === editingProject.projectId);
    if (!project) {
      setEditingProject(null);
      return;
    }

    const nextName = editingProject.name.trim();
    const nextEmoji = editingProject.emoji.trim();
    const nextGroupName = editingProject.groupName.trim();

    if (nextName.length === 0) {
      toastManager.add({
        type: "warning",
        title: "Project name cannot be empty",
      });
      return;
    }

    const patch: {
      title?: string;
      emoji?: string | null;
      groupName?: string | null;
      groupEmoji?: string | null;
    } = {};

    if (nextName !== project.name) {
      patch.title = nextName;
    }
    if (nextEmoji !== (project.emoji ?? "")) {
      patch.emoji = nextEmoji.length > 0 ? nextEmoji : null;
    }
    if (nextGroupName !== (project.groupName ?? "")) {
      patch.groupName = nextGroupName.length > 0 ? nextGroupName : null;
      patch.groupEmoji =
        nextGroupName.length > 0
          ? (projects.find(
              (entry) => entry.id !== project.id && entry.groupName === nextGroupName,
            )?.groupEmoji ?? null)
          : null;
    }

    if (Object.keys(patch).length === 0) {
      setEditingProject(null);
      return;
    }

    setIsSavingProjectEdit(true);
    try {
      await updateProjectMetadata(editingProject.projectId, patch);
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
  }, [editingProject, isSavingProjectEdit, projects, updateProjectMetadata]);

  const saveProjectGroupEdit = useCallback(async () => {
    if (!editingProjectGroup || isSavingProjectEdit) {
      return;
    }

    const nextGroupName = editingProjectGroup.nextName.trim();
    const nextGroupEmoji = editingProjectGroup.nextEmoji.trim();
    if (
      nextGroupName === editingProjectGroup.currentName &&
      nextGroupEmoji === editingProjectGroup.currentEmoji
    ) {
      setEditingProjectGroup(null);
      return;
    }

    setIsSavingProjectEdit(true);
    try {
      await updateProjectsGroupMetadata(
        editingProjectGroup.projectIds,
        {
          groupName: nextGroupName.length > 0 ? nextGroupName : null,
          groupEmoji: nextGroupName.length > 0 && nextGroupEmoji.length > 0 ? nextGroupEmoji : null,
        },
      );
      setEditingProjectGroup(null);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Failed to update folder",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    } finally {
      setIsSavingProjectEdit(false);
    }
  }, [editingProjectGroup, isSavingProjectEdit, updateProjectsGroupMetadata]);

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
        toastManager.add({
          type: "warning",
          title: "Thread title cannot be empty",
        });
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

  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: ThreadId;
  }>({
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
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{
    path: string;
  }>({
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
      const thread = sidebarThreadsById[threadId];
      if (!thread) return;
      const threadWorkspacePath =
        thread.worktreePath ?? projectCwdById.get(thread.projectId) ?? null;
      const isArchived = thread.archivedAt !== null;
      const clicked = await api.contextMenu.show(
        isArchived
          ? [
              { id: "rename", label: "Rename thread" },
              { id: "unarchive", label: "Unarchive" },
              { id: "copy-path", label: "Copy Path" },
              { id: "copy-thread-id", label: "Copy Thread ID" },
              { id: "delete", label: "Delete", destructive: true },
            ]
          : [
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
        markThreadUnread(threadId, thread.latestTurn?.completedAt);
        return;
      }
      if (clicked === "unarchive") {
        try {
          await unarchiveThread(threadId);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to unarchive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
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
      sidebarThreadsById,
      unarchiveThread,
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
          const thread = sidebarThreadsById[id];
          markThreadUnread(id, thread?.latestTurn?.completedAt);
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
      sidebarThreadsById,
    ],
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

      // Plain click — clear selection, set anchor for future shift-clicks, and navigate
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadId);
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [
      clearSelection,
      navigate,
      rangeSelectTo,
      selectedThreadIds.size,
      setSelectionAnchor,
      toggleThreadSelection,
    ],
  );

  const navigateToThread = useCallback(
    (threadId: ThreadId) => {
      if (selectedThreadIds.size > 0) {
        clearSelection();
      }
      setSelectionAnchor(threadId);
      void navigate({
        to: "/$threadId",
        params: { threadId },
      });
    },
    [clearSelection, navigate, selectedThreadIds.size, setSelectionAnchor],
  );

  const handleProjectContextMenu = useCallback(
    async (projectId: ProjectId, position: { x: number; y: number }) => {
      const api = readNativeApi();
      if (!api) return;
      const project = projects.find((entry) => entry.id === projectId);
      if (!project) return;

      const clicked = await api.contextMenu.show(
        [
          { id: "edit", label: "Edit project" },
          { id: "pin", label: pinnedProjectIdSet.has(project.id) ? "Unpin project" : "Pin project" },
          { id: "copy-path", label: "Copy Project Path" },
          { id: "delete", label: "Remove project", destructive: true },
        ],
        position,
      );
      if (clicked === "edit") {
        openProjectEditor(project);
        return;
      }
      if (clicked === "copy-path") {
        copyPathToClipboard(project.cwd, { path: project.cwd });
        return;
      }
      if (clicked === "pin") {
        toggleProjectPinned(project.id);
        return;
      }
      if (clicked !== "delete") return;

      const projectThreadIds = threadIdsByProjectId[projectId] ?? [];
      if (projectThreadIds.length > 0) {
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
      copyPathToClipboard,
      getDraftThreadByProjectId,
      openProjectEditor,
      pinnedProjectIdSet,
      projects,
      threadIdsByProjectId,
      toggleProjectPinned,
    ],
  );

  const handleProjectGroupContextMenu = useCallback(
    async (
      groupName: string,
      groupEmoji: string | null,
      projectIds: readonly ProjectId[],
      position: { x: number; y: number },
    ) => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      const clicked = await api.contextMenu.show(
        [
          { id: "rename", label: "Rename folder" },
          { id: "clear", label: "Remove folder" },
        ],
        position,
      );

      if (clicked === "rename") {
        setEditingProjectGroup({
          currentName: groupName,
          nextName: groupName,
          currentEmoji: groupEmoji ?? "",
          nextEmoji: groupEmoji ?? "",
          projectIds: [...projectIds],
        });
        return;
      }

      if (clicked !== "clear") {
        return;
      }

      try {
        await updateProjectsGroupMetadata(projectIds, {
          groupName: null,
          groupEmoji: null,
        });
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to remove folder",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [updateProjectsGroupMetadata],
  );

  const focusThreadSearch = useCallback(() => {
    if (!open) {
      setOpen(true);
    }

    requestAnimationFrame(() => {
      threadSearchInputRef.current?.focus();
      threadSearchInputRef.current?.select();
    });
  }, [open, setOpen]);

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
      dragInProgressRef.current = false;
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeProject = sidebarProjects.find((project) => project.id === active.id);
      if (!activeProject) return;

      const targetGroupName = decodeGroupDropId(over.id);
      if (targetGroupName !== null) {
        const targetGroupEmoji =
          sidebarProjects.find((project) => project.groupName === targetGroupName)?.groupEmoji ??
          null;
        if (
          (activeProject.groupName ?? "") === targetGroupName &&
          (activeProject.groupEmoji ?? null) === targetGroupEmoji
        ) {
          return;
        }

        void updateProjectsGroupMetadata([activeProject.id], {
          groupName: targetGroupName,
          groupEmoji: targetGroupEmoji,
        }).catch((error) => {
          toastManager.add({
            type: "error",
            title: "Failed to move project",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        });
        return;
      }

      if (appSettings.sidebarProjectSortOrder !== "manual") {
        return;
      }
      const overProject = sidebarProjects.find((project) => project.id === over.id);
      if (!overProject) return;
      reorderProjects(activeProject.id, overProject.id);
    },
    [appSettings.sidebarProjectSortOrder, reorderProjects, sidebarProjects, updateProjectsGroupMetadata],
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

  const handleProjectTitlePointerDownCapture = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      suppressProjectClickForContextMenuRef.current = false;
      if (
        isContextMenuPointerDown({
          button: event.button,
          ctrlKey: event.ctrlKey,
          isMac: isMacPlatform(navigator.platform),
        })
      ) {
        // Keep context-menu gestures from arming the sortable drag sensor.
        event.stopPropagation();
      }

      suppressProjectClickAfterDragRef.current = false;
    },
    [],
  );

  const sidebarVisibleThreads = useMemo(
    () => threads.filter((thread) => showArchivedThreads || thread.archivedAt === null),
    [showArchivedThreads, threads],
  );
  const searchVisibleThreads = useMemo(
    () =>
      hasThreadSearch
        ? sidebarVisibleThreads.filter((thread) =>
            matchesSidebarThreadSearch(thread, normalizedThreadSearchQuery),
          )
        : sidebarVisibleThreads,
    [hasThreadSearch, normalizedThreadSearchQuery, sidebarVisibleThreads],
  );
  const matchedThreadIds = useMemo(
    () => new Set(searchVisibleThreads.map((thread) => thread.id)),
    [searchVisibleThreads],
  );
  const searchMatchByThreadId = useMemo(
    () =>
      new Map(
        searchVisibleThreads.flatMap((thread) => {
          const match = resolveSidebarThreadSearchMatch(thread, normalizedThreadSearchQuery);
          return match ? [[thread.id, match] as const] : [];
        }),
      ),
    [normalizedThreadSearchQuery, searchVisibleThreads],
  );
  const sortedProjects = useMemo(
    () =>
      sortProjectsForSidebar(
        sidebarProjects,
        searchVisibleThreads,
        appSettings.sidebarProjectSortOrder,
      ),
    [appSettings.sidebarProjectSortOrder, searchVisibleThreads, sidebarProjects],
  );
  const isManualProjectSorting = appSettings.sidebarProjectSortOrder === "manual";
  const renderedProjects = useMemo(
    () =>
      sortedProjects.map((project) => {
        const resolveProjectThreadStatus = (
          thread: NonNullable<(typeof sidebarThreadsById)[string]>,
        ) =>
          resolveThreadStatusPill({
            thread: {
              ...thread,
              lastVisitedAt: threadLastVisitedAtById[thread.id],
            },
          });
        const allProjectThreads = sortThreadsForSidebar(
          (threadIdsByProjectId[project.id] ?? [])
            .map((threadId) => sidebarThreadsById[threadId])
            .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
            .filter((thread) => showArchivedThreads || thread.archivedAt === null),
          appSettings.sidebarThreadSortOrder,
        );
        const projectThreads = hasThreadSearch
          ? allProjectThreads.filter((thread) => matchedThreadIds.has(thread.id))
          : allProjectThreads;
        const activeVisibleProjectThreads = projectThreads.filter((thread) => thread.archivedAt === null);
        const projectStatus = resolveProjectStatusIndicator(
          activeVisibleProjectThreads.map((thread) => resolveProjectThreadStatus(thread)),
        );
        const activeThreadId = routeThreadId ?? undefined;
        const isThreadListExpanded = expandedThreadListsByProject.has(project.id);
        const pinnedCollapsedThread =
          !hasThreadSearch && !project.expanded && activeThreadId
            ? (allProjectThreads.find((thread) => thread.id === activeThreadId) ?? null)
            : null;
        const shouldShowThreadPanel = hasThreadSearch
          ? projectThreads.length > 0
          : project.expanded || pinnedCollapsedThread !== null;
        const {
          hasHiddenThreads,
          hiddenThreads,
          visibleThreads: visibleProjectThreads,
        } = hasThreadSearch
          ? {
              hasHiddenThreads: false,
              hiddenThreads: [],
              visibleThreads: projectThreads,
            }
          : getVisibleThreadsForProject({
              threads: projectThreads,
              activeThreadId,
              isThreadListExpanded,
              previewLimit: THREAD_PREVIEW_LIMIT,
            });
        const hiddenThreadStatus = resolveProjectStatusIndicator(
          hiddenThreads
            .filter((thread) => thread.archivedAt === null)
            .map((thread) => resolveProjectThreadStatus(thread)),
        );
        const orderedProjectThreadIds = projectThreads.map((thread) => thread.id);
        const renderedThreadIds = pinnedCollapsedThread
          ? [pinnedCollapsedThread.id]
          : visibleProjectThreads.map((thread) => thread.id);
        const showEmptyThreadState = !hasThreadSearch && project.expanded && projectThreads.length === 0;

        return {
          hasHiddenThreads,
          hiddenThreadStatus,
          threadCount: projectThreads.length,
          orderedProjectThreadIds,
          project,
          projectStatus,
          renderedThreadIds,
          showEmptyThreadState,
          shouldShowThreadPanel,
          isThreadListExpanded,
        };
      }).filter((renderedProject) => !hasThreadSearch || renderedProject.renderedThreadIds.length > 0),
    [
      appSettings.sidebarThreadSortOrder,
      expandedThreadListsByProject,
      hasThreadSearch,
      matchedThreadIds,
      routeThreadId,
      sortedProjects,
      sidebarThreadsById,
      showArchivedThreads,
      threadIdsByProjectId,
      threadLastVisitedAtById,
    ],
  );
  const pinnedRenderedProjects = useMemo(
    () =>
      orderItemsByPreferredIds({
        items: renderedProjects.filter((renderedProject) => pinnedProjectIdSet.has(renderedProject.project.id)),
        preferredIds: pinnedProjectIds,
        getId: (renderedProject) => renderedProject.project.id,
      }),
    [pinnedProjectIdSet, pinnedProjectIds, renderedProjects],
  );
  const unpinnedRenderedProjects = useMemo(
    () => renderedProjects.filter((renderedProject) => !pinnedProjectIdSet.has(renderedProject.project.id)),
    [pinnedProjectIdSet, renderedProjects],
  );
  const projectSections = useMemo(
    () => groupProjectsForSidebar(unpinnedRenderedProjects),
    [unpinnedRenderedProjects],
  );
  const visibleSidebarThreadIds = useMemo(
    () =>
      getVisibleSidebarThreadIds(
        [
          ...pinnedRenderedProjects,
          ...projectSections.flatMap((section) =>
            !hasThreadSearch &&
            section.groupName !== null &&
            collapsedProjectGroupSet.has(section.groupName)
              ? []
              : section.projects,
          ),
        ],
      ),
    [collapsedProjectGroupSet, hasThreadSearch, pinnedRenderedProjects, projectSections],
  );
  const threadJumpCommandById = useMemo(() => {
    const mapping = new Map<ThreadId, NonNullable<ReturnType<typeof threadJumpCommandForIndex>>>();
    for (const [visibleThreadIndex, threadId] of visibleSidebarThreadIds.entries()) {
      const jumpCommand = threadJumpCommandForIndex(visibleThreadIndex);
      if (!jumpCommand) {
        return mapping;
      }
      mapping.set(threadId, jumpCommand);
    }

    return mapping;
  }, [visibleSidebarThreadIds]);
  const threadJumpThreadIds = useMemo(
    () => [...threadJumpCommandById.keys()],
    [threadJumpCommandById],
  );
  const threadJumpLabelById = useMemo(() => {
    const mapping = new Map<ThreadId, string>();
    for (const [threadId, command] of threadJumpCommandById) {
      const label = shortcutLabelForCommand(keybindings, command, sidebarShortcutLabelOptions);
      if (label) {
        mapping.set(threadId, label);
      }
    }
    return mapping;
  }, [keybindings, sidebarShortcutLabelOptions, threadJumpCommandById]);
  const orderedSidebarThreadIds = visibleSidebarThreadIds;

  useEffect(() => {
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const activeElement = document.activeElement;
      if (isEditableElement(activeElement) || isTerminalFocused()) {
        return;
      }

      const key = event.key.toLocaleLowerCase();
      const isGlobalSearchShortcut =
        (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && key === "f";
      const isSlashShortcut =
        !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && key === "/";
      if (!isGlobalSearchShortcut && !isSlashShortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      focusThreadSearch();
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [focusThreadSearch]);

  useEffect(() => {
    const getShortcutContext = () => ({
      terminalFocus: isTerminalFocused(),
      terminalOpen: routeTerminalOpen,
    });

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      updateThreadJumpHintsVisibility(
        shouldShowThreadJumpHints(event, keybindings, {
          platform,
          context: getShortcutContext(),
        }),
      );

      if (event.defaultPrevented || event.repeat) {
        return;
      }

      const command = resolveShortcutCommand(event, keybindings, {
        platform,
        context: getShortcutContext(),
      });
      const traversalDirection = threadTraversalDirectionFromCommand(command);
      if (traversalDirection !== null) {
        const targetThreadId = resolveAdjacentThreadId({
          threadIds: orderedSidebarThreadIds,
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

      const targetThreadId = threadJumpThreadIds[jumpIndex];
      if (!targetThreadId) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      navigateToThread(targetThreadId);
    };

    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      updateThreadJumpHintsVisibility(
        shouldShowThreadJumpHints(event, keybindings, {
          platform,
          context: getShortcutContext(),
        }),
      );
    };

    const onWindowBlur = () => {
      updateThreadJumpHintsVisibility(false);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    window.addEventListener("keyup", onWindowKeyUp);
    window.addEventListener("blur", onWindowBlur);

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
      window.removeEventListener("keyup", onWindowKeyUp);
      window.removeEventListener("blur", onWindowBlur);
    };
  }, [
    keybindings,
    navigateToThread,
    orderedSidebarThreadIds,
    platform,
    routeTerminalOpen,
    routeThreadId,
    threadJumpThreadIds,
    updateThreadJumpHintsVisibility,
  ]);

  function renderProjectItem(
    renderedProject: (typeof renderedProjects)[number],
    dragHandleProps: SortableProjectHandleProps | null,
  ) {
    const {
      hasHiddenThreads,
      hiddenThreadStatus,
      orderedProjectThreadIds,
      project,
      projectStatus,
      renderedThreadIds,
      showEmptyThreadState,
      shouldShowThreadPanel,
      threadCount,
      isThreadListExpanded,
    } = renderedProject;
    return (
      <>
        <div className="group/project-header relative">
          <SidebarMenuButton
            ref={isManualProjectSorting ? dragHandleProps?.setActivatorNodeRef : undefined}
            size="sm"
            className={`gap-2 px-2 py-1.5 text-left hover:bg-accent group-hover/project-header:bg-accent group-hover/project-header:text-sidebar-accent-foreground ${
              isManualProjectSorting ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"
            }`}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.attributes : {})}
            {...(isManualProjectSorting && dragHandleProps ? dragHandleProps.listeners : {})}
            onPointerDownCapture={handleProjectTitlePointerDownCapture}
            onClick={(event) => handleProjectTitleClick(event, project.id)}
            onKeyDown={(event) => handleProjectTitleKeyDown(event, project.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              suppressProjectClickForContextMenuRef.current = true;
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
            <ProjectFavicon cwd={project.cwd} emoji={project.emoji} />
            <span className="flex-1 truncate text-xs font-medium text-foreground/90">
              {project.name}
            </span>
            {pinnedProjectIdSet.has(project.id) ? (
              <PinIcon className="size-3 shrink-0 text-muted-foreground/65" />
            ) : null}
            <span className="inline-flex shrink-0 items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground/70">
              {threadCount}
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
                  className="top-1 right-1.5 size-5 rounded-md p-0 text-muted-foreground/70 hover:bg-secondary hover:text-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const seedContext = resolveSidebarNewThreadSeedContext({
                      projectId: project.id,
                      defaultEnvMode: resolveSidebarNewThreadEnvMode({
                        defaultEnvMode: appSettings.defaultThreadEnvMode,
                      }),
                      activeThread:
                        activeThread && activeThread.projectId === project.id
                          ? {
                              projectId: activeThread.projectId,
                              branch: activeThread.branch,
                              worktreePath: activeThread.worktreePath,
                            }
                          : null,
                      activeDraftThread:
                        activeDraftThread && activeDraftThread.projectId === project.id
                          ? {
                              projectId: activeDraftThread.projectId,
                              branch: activeDraftThread.branch,
                              worktreePath: activeDraftThread.worktreePath,
                              envMode: activeDraftThread.envMode,
                            }
                          : null,
                    });
                    void handleNewThread(project.id, {
                      ...(seedContext.branch !== undefined ? { branch: seedContext.branch } : {}),
                      ...(seedContext.worktreePath !== undefined
                        ? { worktreePath: seedContext.worktreePath }
                        : {}),
                      envMode: seedContext.envMode,
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

        <SidebarMenuSub
          ref={attachThreadListAutoAnimateRef}
          className="mx-1 my-0 w-full translate-x-0 gap-0.5 overflow-hidden px-1.5 py-0"
        >
          {shouldShowThreadPanel && showEmptyThreadState ? (
            <SidebarMenuSubItem className="w-full" data-thread-selection-safe>
              <div
                data-thread-selection-safe
                className="flex h-6 w-full translate-x-0 items-center px-2 text-left text-[10px] text-muted-foreground/60"
              >
                <span>
                  {showArchivedThreads
                    ? "No threads in this project yet."
                    : "No active threads yet. Start one with the compose button."}
                </span>
              </div>
            </SidebarMenuSubItem>
          ) : null}
          {shouldShowThreadPanel &&
            renderedThreadIds.map((threadId) => (
              <SidebarThreadRow
                key={threadId}
                threadId={threadId}
                projectCwd={project.cwd}
                orderedProjectThreadIds={orderedProjectThreadIds}
                routeThreadId={routeThreadId}
                selectedThreadIds={selectedThreadIds}
                showThreadJumpHints={showThreadJumpHints}
                jumpLabel={threadJumpLabelById.get(threadId) ?? null}
                searchMatch={searchMatchByThreadId.get(threadId) ?? null}
                appSettingsConfirmThreadArchive={appSettings.confirmThreadArchive}
                renamingThreadId={renamingThreadId}
                renamingTitle={renamingTitle}
                setRenamingTitle={setRenamingTitle}
                renamingInputRef={renamingInputRef}
                renamingCommittedRef={renamingCommittedRef}
                confirmingArchiveThreadId={confirmingArchiveThreadId}
                setConfirmingArchiveThreadId={setConfirmingArchiveThreadId}
                confirmArchiveButtonRefs={confirmArchiveButtonRefs}
                handleThreadClick={handleThreadClick}
                navigateToThread={navigateToThread}
                handleMultiSelectContextMenu={handleMultiSelectContextMenu}
                handleThreadContextMenu={handleThreadContextMenu}
                clearSelection={clearSelection}
                commitRename={commitRename}
                cancelRename={cancelRename}
                attemptArchiveThread={attemptArchiveThread}
                openPrLink={openPrLink}
              />
            ))}

          {project.expanded && hasHiddenThreads && !isThreadListExpanded && (
            <SidebarMenuSubItem className="w-full">
              <SidebarMenuSubButton
                render={<button type="button" />}
                data-thread-selection-safe
                size="sm"
                className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                onClick={() => {
                  expandThreadListForProject(project.id);
                }}
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  {hiddenThreadStatus && <ThreadStatusLabel status={hiddenThreadStatus} compact />}
                  <span>Show more</span>
                </span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
          {project.expanded && hasHiddenThreads && isThreadListExpanded && (
            <SidebarMenuSubItem className="w-full">
              <SidebarMenuSubButton
                render={<button type="button" />}
                data-thread-selection-safe
                size="sm"
                className="h-6 w-full translate-x-0 justify-start px-2 text-left text-[10px] text-muted-foreground/60 hover:bg-accent hover:text-muted-foreground/80"
                onClick={() => {
                  collapseThreadListForProject(project.id);
                }}
              >
                <span>Show less</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
        </SidebarMenuSub>
      </>
    );
  }

  function renderProjectList(
    sectionProjects: readonly (typeof renderedProjects)[number][],
    input: {
      manualSorting: boolean;
      attachAutoAnimateRef?: ((node: HTMLElement | null) => void) | undefined;
    },
  ) {
    if (input.manualSorting) {
      return (
        <SidebarMenu ref={input.attachAutoAnimateRef}>
          <SortableContext
            items={sectionProjects.map((renderedProject) => renderedProject.project.id)}
            strategy={verticalListSortingStrategy}
          >
            {sectionProjects.map((renderedProject) => (
              <SortableProjectItem
                key={renderedProject.project.id}
                projectId={renderedProject.project.id}
              >
                {(dragHandleProps) => renderProjectItem(renderedProject, dragHandleProps)}
              </SortableProjectItem>
            ))}
          </SortableContext>
        </SidebarMenu>
      );
    }

    return (
      <SidebarMenu ref={input.attachAutoAnimateRef}>
        {sectionProjects.map((renderedProject) => (
          <SidebarMenuItem key={renderedProject.project.id} className="rounded-md">
            {renderProjectItem(renderedProject, null)}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    );
  }

  function renderProjectSections() {
    const ungroupedSection =
      projectSections.find((section) => section.groupName === null) ?? null;
    const groupedSections = projectSections.filter((section) => section.groupName !== null);
    const content = (
      <div ref={attachProjectListAutoAnimateRef} className="space-y-2">
        {pinnedRenderedProjects.length > 0 ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              <span>Pinned</span>
              <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-muted-foreground/70">
                {pinnedRenderedProjects.length}
              </span>
            </div>
            {renderProjectList(pinnedRenderedProjects, {
              manualSorting: isManualProjectSorting,
            })}
          </div>
        ) : null}

        {ungroupedSection ? (
          <div>
            {renderProjectList(ungroupedSection.projects, {
              manualSorting: isManualProjectSorting,
            })}
          </div>
        ) : null}

        {groupedSections.map((section) => {
          const groupName = section.groupName!;

          const containsActiveThread =
            routeThreadId !== null &&
            section.projects.some((project) => project.renderedThreadIds.includes(routeThreadId));
          const isCollapsed =
            !hasThreadSearch &&
            collapsedProjectGroupSet.has(groupName) &&
            !containsActiveThread;

          return (
            <div key={section.key} className="space-y-1">
              <ProjectGroupHeader
                collapsed={isCollapsed}
                emoji={section.groupEmoji}
                groupName={groupName}
                manualSorting={isManualProjectSorting}
                onAddProject={() => handleStartAddProjectForGroup(groupName, section.groupEmoji)}
                projectCount={section.projects.length}
                onClick={() => toggleProjectGroupCollapsed(groupName)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleProjectGroupContextMenu(
                    groupName,
                    section.groupEmoji,
                    section.projects.map((entry) => entry.project.id),
                    {
                      x: event.clientX,
                      y: event.clientY,
                    },
                  );
                }}
              />
              {!isCollapsed
                ? renderProjectList(section.projects, {
                    manualSorting: isManualProjectSorting,
                  })
                : null}
            </div>
          );
        })}
      </div>
    );

    if (!isManualProjectSorting) {
      return content;
    }

    return (
      <DndContext
        sensors={projectDnDSensors}
        collisionDetection={projectCollisionDetection}
        modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
        onDragStart={handleProjectDragStart}
        onDragEnd={handleProjectDragEnd}
        onDragCancel={handleProjectDragCancel}
      >
        {content}
      </DndContext>
    );
  }

  const handleProjectTitleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>, projectId: ProjectId) => {
      if (suppressProjectClickForContextMenuRef.current) {
        suppressProjectClickForContextMenuRef.current = false;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
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
    (event: KeyboardEvent<HTMLButtonElement>, projectId: ProjectId) => {
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
  const newThreadShortcutLabel =
    shortcutLabelForCommand(keybindings, "chat.newLocal", sidebarShortcutLabelOptions) ??
    shortcutLabelForCommand(keybindings, "chat.new", sidebarShortcutLabelOptions);

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
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(desktopUpdateState),
      );
      if (!confirmed) return;
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

  const wordmark = (
    <div className="flex min-w-0 items-center gap-2">
      <SidebarTrigger className="shrink-0 md:hidden" />
      <Tooltip>
        <TooltipTrigger
          render={
            <Link
              aria-label="Go to threads"
              className="ml-1 flex min-w-0 flex-1 cursor-pointer items-center gap-1 rounded-md outline-hidden ring-ring transition-colors hover:text-foreground focus-visible:ring-2"
              to="/"
            >
              <T3Wordmark />
              <span className="truncate text-sm font-medium tracking-tight text-muted-foreground">
                Code
              </span>
              <span className="rounded-full bg-muted/50 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.18em] text-muted-foreground/60">
                {APP_STAGE_LABEL}
              </span>
            </Link>
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
      {isElectron ? (
        <SidebarHeader className="drag-region h-[52px] flex-row items-center gap-2 px-4 py-0 pl-[90px]">
          {wordmark}
        </SidebarHeader>
      ) : (
        <SidebarHeader className="gap-3 px-3 py-2 sm:gap-2.5 sm:px-4 sm:py-3">
          {wordmark}
        </SidebarHeader>
      )}

      {isOnSettings ? (
        <SettingsSidebarNav pathname={pathname} />
      ) : (
        <>
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
              {shouldShowProjectPathEntry && addProjectDraft ? (
                <div className="mb-2 space-y-2 rounded-lg border border-border/70 bg-secondary/40 p-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-foreground/90">
                        {isAddingWorkspace ? "New workspace" : "New project"}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {isAddingWorkspace
                          ? "Create a workspace by adding its first project."
                          : `Add a project to ${addProjectDraft.groupName}.`}
                      </p>
                    </div>
                    <button
                      type="button"
                      aria-label="Close add form"
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => {
                        setAddProjectDraft(null);
                        setAddProjectError(null);
                        setNewCwd("");
                      }}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>

                  {isAddingWorkspace ? (
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px]">
                      <input
                        className="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                        placeholder="Workspace name"
                        autoFocus
                        value={addProjectDraft.groupName}
                        onChange={(event) => {
                          setAddProjectDraft((current) =>
                            current ? { ...current, groupName: event.target.value } : current,
                          );
                          setAddProjectError(null);
                        }}
                      />
                      <input
                        className="min-w-0 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/40 focus:border-ring focus:outline-none"
                        placeholder="Emoji"
                        maxLength={16}
                        value={addProjectDraft.groupEmoji}
                        onChange={(event) => {
                          setAddProjectDraft((current) =>
                            current ? { ...current, groupEmoji: event.target.value } : current,
                          );
                          setAddProjectError(null);
                        }}
                      />
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-2 rounded-md border border-border/70 bg-background/70 px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                      {addProjectDraft.groupEmoji ? (
                        <span className="text-sm leading-none">{addProjectDraft.groupEmoji}</span>
                      ) : (
                        <FolderIcon className="size-3.5" />
                      )}
                      <span className="truncate">{addProjectDraft.groupName}</span>
                    </div>
                  )}

                  {isElectron && (
                    <button
                      type="button"
                      className="mb-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-secondary py-1.5 text-xs text-foreground/80 transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => void handlePickFolder(addProjectDraft)}
                      disabled={isPickingFolder || isAddingProject}
                    >
                      <FolderIcon className="size-3.5" />
                      {isPickingFolder ? "Picking folder..." : "Browse for project"}
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
                          setAddProjectDraft(null);
                          setAddProjectError(null);
                          setNewCwd("");
                        }
                      }}
                      autoFocus={!isAddingWorkspace}
                    />
                    <button
                      type="button"
                      className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-colors duration-150 hover:bg-primary/90 disabled:opacity-60"
                      onClick={handleAddProject}
                      disabled={!canAddProject}
                    >
                      {isAddingProject
                        ? "Adding..."
                        : isAddingWorkspace
                          ? "Add workspace"
                          : "Add project"}
                    </button>
                  </div>
                  {addProjectError && (
                    <p className="mt-1 px-0.5 text-[11px] leading-tight text-red-400">
                      {addProjectError}
                    </p>
                  )}
                </div>
              ) : null}

              <div className="mb-2 flex items-center gap-1.5 px-1">
                <div className="relative min-w-0 flex-1">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/50" />
                  <Input
                    ref={threadSearchInputRef}
                    value={threadSearchQuery}
                    onChange={(event) => setThreadSearchQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && threadSearchQuery.length > 0) {
                        event.preventDefault();
                        setThreadSearchQuery("");
                      }
                    }}
                    placeholder="Search"
                    disabled={projects.length === 0}
                    className="h-8 border-border bg-secondary pr-8 pl-8 text-xs disabled:cursor-default disabled:opacity-60"
                  />
                  {threadSearchQuery.length > 0 ? (
                    <button
                      type="button"
                      aria-label="Clear thread search"
                      className="absolute top-1/2 right-1.5 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                      onClick={() => setThreadSearchQuery("")}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        aria-label={isAddingWorkspace ? "Cancel add workspace" : "Add workspace"}
                        aria-pressed={isAddingWorkspace}
                        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
                        onClick={handleStartAddWorkspace}
                      />
                    }
                  >
                    {isAddingWorkspace ? (
                      <XIcon className="size-3.5" />
                    ) : (
                      <FolderPlusIcon className="size-3.5" />
                    )}
                  </TooltipTrigger>
                  <TooltipPopup side="right">
                    {isAddingWorkspace ? "Cancel add workspace" : "Add workspace"}
                  </TooltipPopup>
                </Tooltip>
                {archivedThreadCount > 0 ? (
                  <button
                    type="button"
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[10px] font-medium transition-colors ${
                      showArchivedThreads
                        ? "border-primary/30 bg-primary/10 text-foreground"
                        : "border-border bg-secondary text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                    }`}
                    onClick={() => setShowArchivedThreads(!showArchivedThreads)}
                  >
                    {showArchivedThreads ? (
                      <ArchiveXIcon className="size-3.5" />
                    ) : (
                      <ArchiveIcon className="size-3.5" />
                    )}
                    <span>{showArchivedThreads ? "Hide archived" : "Show archived"}</span>
                    <span className="inline-flex items-center rounded-full border border-border/70 bg-background/70 px-1 py-0.5 text-[9px] leading-none text-muted-foreground/70">
                      {archivedThreadCount}
                    </span>
                  </button>
                ) : null}
              </div>

              {renderProjectSections()}

              {hasThreadSearch && renderedProjects.length === 0 ? (
                <div className="px-2 pt-4 text-center text-xs text-muted-foreground/60">
                  No matching threads
                </div>
              ) : null}

              {projects.length === 0 && !shouldShowProjectPathEntry && !hasThreadSearch && (
                <div className="space-y-1 px-2 pt-4 text-center text-xs text-muted-foreground/60">
                  <p>No projects yet</p>
                  <p>Add a workspace to start organizing threads here.</p>
                </div>
              )}
            </SidebarGroup>
          </SidebarContent>

          <SidebarSeparator />
          <SidebarFooter className="p-2">
            <SidebarUpdatePill />
            <div className="flex items-center justify-between gap-2">
              <SidebarMenu className="min-w-0 flex-1">
                <SidebarMenuItem>
                  <SidebarMenuButton
                    size="sm"
                    className="gap-2 px-2 py-1.5 text-muted-foreground/70 hover:bg-accent hover:text-foreground"
                    onClick={() => void navigate({ to: "/settings" })}
                  >
                    <SettingsIcon className="size-3.5" />
                    <span className="text-xs">Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
              <SidebarTrigger
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="hidden shrink-0 text-muted-foreground/70 hover:bg-accent hover:text-foreground md:inline-flex"
              />
            </div>
          </SidebarFooter>
        </>
      )}

      <Dialog
        open={editingProject !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingProjectEdit) {
            setEditingProject(null);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Edit Project</DialogTitle>
            <DialogDescription>
              Customize how this project appears in the sidebar.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
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
              <FieldLabel>Emoji</FieldLabel>
              <Input
                value={editingProject?.emoji ?? ""}
                onChange={(event) =>
                  setEditingProject((current) =>
                    current ? { ...current, emoji: event.target.value } : current,
                  )
                }
                placeholder="✨"
                maxLength={16}
              />
              <FieldDescription>Optional. Shown before the project name.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Folder</FieldLabel>
              <Input
                value={editingProject?.groupName ?? ""}
                onChange={(event) =>
                  setEditingProject((current) =>
                    current ? { ...current, groupName: event.target.value } : current,
                  )
                }
                placeholder="Client work"
                maxLength={64}
              />
              <FieldDescription>
                Projects with the same folder name are grouped together in the sidebar.
              </FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              variant="outline"
              onClick={() => setEditingProject(null)}
              disabled={isSavingProjectEdit}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveProjectEdit()} disabled={isSavingProjectEdit}>
              {isSavingProjectEdit ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={editingProjectGroup !== null}
        onOpenChange={(open) => {
          if (!open && !isSavingProjectEdit) {
            setEditingProjectGroup(null);
          }
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
            <DialogDescription>
              Update the shared folder name for these projects.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Field>
              <FieldLabel>Folder name</FieldLabel>
              <Input
                value={editingProjectGroup?.nextName ?? ""}
                onChange={(event) =>
                  setEditingProjectGroup((current) =>
                    current ? { ...current, nextName: event.target.value } : current,
                  )
                }
                placeholder="Client work"
                maxLength={64}
              />
              <FieldDescription>
                Clear the field to remove the folder and leave the projects ungrouped.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Folder emoji</FieldLabel>
              <Input
                value={editingProjectGroup?.nextEmoji ?? ""}
                onChange={(event) =>
                  setEditingProjectGroup((current) =>
                    current ? { ...current, nextEmoji: event.target.value } : current,
                  )
                }
                placeholder="🗂️"
                maxLength={16}
              />
              <FieldDescription>
                Optional. Shown on the folder header and shared by that workspace.
              </FieldDescription>
            </Field>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              variant="outline"
              onClick={() => setEditingProjectGroup(null)}
              disabled={isSavingProjectEdit}
            >
              Cancel
            </Button>
            <Button onClick={() => void saveProjectGroupEdit()} disabled={isSavingProjectEdit}>
              {isSavingProjectEdit ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </>
  );
}
