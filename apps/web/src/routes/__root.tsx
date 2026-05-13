import {
  type OrchestrationReadModel,
  type OrchestrationThreadActivity,
  type PetCompanionStatusSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useMemo, useRef } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";

import { APP_DISPLAY_NAME } from "../branding";
import { ServerAuthGate } from "../components/ServerAuthGate";
import { TurnCompletionNotifications } from "../TurnCompletionNotifications";
import { Button } from "../components/ui/button";
import { isElectron } from "../env";
import { AnchoredToastProvider, ToastProvider, toastManager } from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { serverConfigQueryOptions, serverQueryKeys } from "../lib/serverReactQuery";
import { readNativeApi } from "../nativeApi";
import { clearPromotedDraftThreads, useComposerDraftStore } from "../composerDraftStore";
import { useStore } from "../store";
import { useTerminalStateStore } from "../terminalStateStore";
import { terminalRunningSubprocessFromEvent } from "../terminalActivity";
import { onServerConfigUpdated, onServerWelcome, onTransportStateChange } from "../wsNativeApi";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { projectQueryKeys } from "../lib/projectReactQuery";
import { collectActiveTerminalThreadIds } from "../lib/terminalStateCleanup";
import {
  readStoredActiveThreadId,
  selectStartupThreadId,
  writeStoredActiveThreadId,
} from "../rootThreadRestore";
import { ServerAuthProvider } from "../serverAuthContext";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  deriveWorkLogEntries,
} from "../session-logic";
import {
  resolveCodexPetUsageSnapshot,
  resolvePetStateFromThreadActivity,
  setDesktopPetCompanionState,
  setDesktopPetCompanionStatus,
  setDesktopPetCompanionUsage,
  shouldShowPetCompanionStatus,
} from "../petCompanion";
import { derivePetCompanionRuntimeSnapshot } from "../petCompanionStatus";
import type { Thread } from "../types";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

const SNAPSHOT_RECOVERY_RETRY_MS = 1_000;

function selectActiveRouteThreadId(state: { matches: Array<{ params: Record<string, unknown> }> }) {
  for (let index = state.matches.length - 1; index >= 0; index -= 1) {
    const candidate = state.matches[index];
    const threadId =
      candidate && "threadId" in candidate.params ? candidate.params.threadId : undefined;
    if (typeof threadId === "string" && threadId.length > 0) {
      return threadId;
    }
  }
  return null;
}

function RootRouteView() {
  return (
    <ServerAuthProvider>
      <ServerAuthGate>
        <AuthenticatedRootRouteView />
      </ServerAuthGate>
    </ServerAuthProvider>
  );
}

function AuthenticatedRootRouteView() {
  if (!readNativeApi()) {
    return (
      <div className="flex h-screen flex-col bg-background text-foreground">
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            Connecting to {APP_DISPLAY_NAME} server...
          </p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <EventRouter />
        <TurnCompletionNotifications />
        <PetCompanionStateBridge />
        <PetCompanionUsageBridge />
        <DesktopProjectBootstrap />
        <Outlet />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function PetCompanionStateBridge() {
  const threads = useStore((store) => store.threads);
  const activeRouteThreadId = useRouterState({ select: selectActiveRouteThreadId });
  const { petState, petStatus } = useMemo(
    () => derivePetCompanionBridgeSnapshot(threads, activeRouteThreadId),
    [activeRouteThreadId, threads],
  );

  useEffect(() => {
    if (!isElectron) return;
    void setDesktopPetCompanionState(petState);
  }, [petState]);

  useEffect(() => {
    if (!isElectron) return;
    void setDesktopPetCompanionStatus(petStatus);
  }, [petStatus]);

  return null;
}

function PetCompanionUsageBridge() {
  const latestRateLimitActivity = useStore(selectLatestCodexRateLimitActivity);

  useEffect(() => {
    if (!isElectron) return;
    if (!latestRateLimitActivity) {
      void setDesktopPetCompanionUsage(null);
      return;
    }

    const payload =
      latestRateLimitActivity.payload &&
      typeof latestRateLimitActivity.payload === "object" &&
      "rateLimits" in latestRateLimitActivity.payload
        ? (latestRateLimitActivity.payload as { rateLimits?: unknown }).rateLimits
        : latestRateLimitActivity.payload;
    void setDesktopPetCompanionUsage(
      resolveCodexPetUsageSnapshot(payload, latestRateLimitActivity.createdAt),
    );
  }, [latestRateLimitActivity]);

  return null;
}

function selectLatestCodexRateLimitActivity(store: {
  threads: Thread[];
}): OrchestrationThreadActivity | null {
  let latestActivity: OrchestrationThreadActivity | null = null;
  let latestTime = 0;
  for (const thread of store.threads) {
    for (const activity of thread.activities) {
      if (activity.kind !== "codex.rate-limits.updated") continue;
      const activityTime = Date.parse(activity.createdAt);
      if (!Number.isFinite(activityTime) || activityTime <= latestTime) continue;
      latestActivity = activity;
      latestTime = activityTime;
    }
  }
  return latestActivity;
}

function derivePetCompanionBridgeSnapshot(
  threads: readonly Thread[],
  activeThreadId: string | null = null,
): {
  petState: ReturnType<typeof resolvePetStateFromThreadActivity>;
  petStatus: PetCompanionStatusSnapshot | null;
} {
  const { petState, statusThread: thread } = derivePetCompanionRuntimeSnapshot(
    threads,
    activeThreadId,
  );
  if (!shouldShowPetCompanionStatus(petState)) return { petState, petStatus: null };
  if (!thread) return { petState, petStatus: null };

  return {
    petState,
    petStatus: {
      title: thread.title.trim() || "T3 Code",
      detail: derivePetCompanionStatusDetail(thread, petState),
      state: petState,
      isLoading: petState === "running",
      updatedAt: thread.updatedAt ?? thread.latestTurn?.startedAt ?? thread.createdAt,
    },
  };
}

function derivePetCompanionStatusDetail(
  thread: Thread,
  state: PetCompanionStatusSnapshot["state"],
): string | null {
  if (state === "waiting") {
    const pendingUserInput = derivePendingUserInputs(thread.activities)[0];
    const activeQuestion = pendingUserInput?.questions[0];
    const question = normalizePetStatusText(activeQuestion?.question);
    if (question) return question;

    const pendingApproval = derivePendingApprovals(thread.activities)[0];
    return normalizePetStatusText(pendingApproval?.detail) ?? "Needs input";
  }

  if (state === "failed") {
    return (
      normalizePetStatusText(thread.error) ??
      normalizePetStatusText(thread.session?.lastError) ??
      "Something went wrong."
    );
  }

  const latestAssistantText = thread.messages
    .toReversed()
    .find((message) => message.role === "assistant" && message.text.trim().length > 0)
    ?.text.trim();
  const assistantDetail = normalizePetStatusText(latestAssistantText);
  if (assistantDetail) return assistantDetail;

  const latestWorkEntry = deriveWorkLogEntries(
    thread.activities,
    thread.latestTurn?.turnId ?? undefined,
  ).at(-1);
  const workDetail =
    normalizePetStatusText(latestWorkEntry?.detail) ??
    normalizePetStatusText(latestWorkEntry?.label);
  if (workDetail) return workDetail;

  return state === "running" ? "Working..." : "Ready for review";
}

function normalizePetStatusText(value: string | null | undefined): string | null {
  if (!value) return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (isDiagnosticPetStatusText(text)) return null;
  return text.length <= 140 ? text : `${text.slice(0, 137).trimEnd()}...`;
}

function isDiagnosticPetStatusText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.startsWith("[") ||
    lower.includes("_diagnostic") ||
    lower.includes("result_type=") ||
    lower.includes("stream_error") ||
    lower.includes("providerruntime") ||
    lower.includes("__") ||
    /^[a-z0-9_.-]+=[^\s]+(?:\s+[a-z0-9_.-]+=)/i.test(text)
  );
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-red-500)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_90%,var(--color-black))_0%,var(--background)_55%)]" />
      </div>

      <section className="relative w-full max-w-xl rounded-2xl border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-8">
        <p className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Something went wrong.
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{message}</p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => reset()}>
            Try again
          </Button>
          <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
            Reload app
          </Button>
        </div>

        <details className="group mt-5 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground">
            <span className="group-open:hidden">Show error details</span>
            <span className="hidden group-open:inline">Hide error details</span>
          </summary>
          <pre className="max-h-56 overflow-auto border-t border-border/70 bg-background/80 px-3 py-2 text-xs text-foreground/85">
            {details}
          </pre>
        </details>
      </section>
    </div>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "An unexpected router error occurred.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

function EventRouter() {
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const setProjectExpanded = useStore((store) => store.setProjectExpanded);
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (store) => store.removeOrphanedTerminalStates,
  );
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeRouteThreadId = useRouterState({ select: selectActiveRouteThreadId });
  const pathnameRef = useRef(pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);

  pathnameRef.current = pathname;

  useEffect(() => {
    if (!activeRouteThreadId || typeof window === "undefined") {
      return;
    }
    writeStoredActiveThreadId(window.localStorage, activeRouteThreadId);
  }, [activeRouteThreadId]);

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    let disposed = false;
    let latestSequence = 0;
    let latestSnapshot: OrchestrationReadModel | null = null;
    let latestWelcomePayload: {
      bootstrapProjectId: string | null;
      bootstrapThreadId: string | null;
    } | null = null;
    let syncing = false;
    let pending = false;
    let needsProviderInvalidation = false;
    let snapshotRetryTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSnapshotRetry = () => {
      if (snapshotRetryTimer === null) {
        return;
      }
      clearTimeout(snapshotRetryTimer);
      snapshotRetryTimer = null;
    };

    const scheduleSnapshotRetry = () => {
      if (disposed || snapshotRetryTimer !== null) {
        return;
      }
      snapshotRetryTimer = setTimeout(() => {
        snapshotRetryTimer = null;
        void syncSnapshot();
      }, SNAPSHOT_RECOVERY_RETRY_MS);
    };

    const flushSnapshotSync = async (): Promise<void> => {
      const snapshot = await api.orchestration.getSnapshot();
      if (disposed) return;
      clearSnapshotRetry();
      latestSnapshot = snapshot;
      latestSequence = Math.max(latestSequence, snapshot.snapshotSequence);
      syncServerReadModel(snapshot);
      clearPromotedDraftThreads(new Set(snapshot.threads.map((t) => t.id)));
      const draftThreadIds = Object.keys(
        useComposerDraftStore.getState().draftThreadsByThreadId,
      ) as ThreadId[];
      const activeThreadIds = collectActiveTerminalThreadIds({
        snapshotThreads: snapshot.threads,
        draftThreadIds,
      });
      removeOrphanedTerminalStates(activeThreadIds);
      if (needsProviderInvalidation) {
        needsProviderInvalidation = false;
        void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
        // Invalidate workspace entry queries so the @-mention file picker
        // reflects files created, deleted, or restored during this turn.
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
      }
      if (pending) {
        pending = false;
        await flushSnapshotSync();
        return;
      }

      if (!latestWelcomePayload?.bootstrapProjectId || !latestWelcomePayload?.bootstrapThreadId) {
        await restoreStartupThread();
      }
    };

    const restoreStartupThread = async () => {
      if (disposed || pathnameRef.current !== "/" || latestSnapshot === null) {
        return;
      }

      const storedThreadId =
        typeof window === "undefined" ? null : readStoredActiveThreadId(window.localStorage);
      const targetThreadId = selectStartupThreadId(latestSnapshot, storedThreadId);
      if (!targetThreadId || handledBootstrapThreadIdRef.current === targetThreadId) {
        return;
      }

      const targetThread = latestSnapshot.threads.find((thread) => thread.id === targetThreadId);
      if (targetThread?.projectId) {
        setProjectExpanded(targetThread.projectId, true);
      }

      await navigate({
        to: "/$threadId",
        params: { threadId: ThreadId.makeUnsafe(targetThreadId) },
        replace: true,
      });
      handledBootstrapThreadIdRef.current = targetThreadId;
    };

    const syncSnapshot = async () => {
      if (syncing) {
        pending = true;
        return;
      }
      syncing = true;
      pending = false;
      try {
        await flushSnapshotSync();
      } catch {
        // Keep prior state and retry so reconnect/startup eventually heals even
        // when there isn't another domain event to kick the loop.
        scheduleSnapshotRetry();
      }
      syncing = false;
    };

    const domainEventFlushThrottler = new Throttler(
      () => {
        void syncSnapshot();
      },
      {
        wait: 100,
        leading: false,
        trailing: true,
      },
    );

    const unsubDomainEvent = api.orchestration.onDomainEvent((event) => {
      if (event.sequence <= latestSequence) {
        return;
      }
      const hasSequenceGap = event.sequence > latestSequence + 1;
      latestSequence = event.sequence;
      if (event.type === "thread.turn-diff-completed" || event.type === "thread.reverted") {
        needsProviderInvalidation = true;
      }
      if (hasSequenceGap) {
        needsProviderInvalidation = true;
        void syncSnapshot();
        return;
      }
      domainEventFlushThrottler.maybeExecute();
    });
    const unsubTransportState = onTransportStateChange((state) => {
      if (state === "open") {
        needsProviderInvalidation = true;
        void syncSnapshot();
      }
    });
    const unsubTerminalEvent = api.terminal.onEvent((event) => {
      const hasRunningSubprocess = terminalRunningSubprocessFromEvent(event);
      if (hasRunningSubprocess === null) {
        return;
      }
      useTerminalStateStore
        .getState()
        .setTerminalActivity(
          ThreadId.makeUnsafe(event.threadId),
          event.terminalId,
          hasRunningSubprocess,
        );
    });
    const unsubWelcome = onServerWelcome((payload) => {
      latestWelcomePayload = {
        bootstrapProjectId: payload.bootstrapProjectId ?? null,
        bootstrapThreadId: payload.bootstrapThreadId ?? null,
      };
      void (async () => {
        await syncSnapshot();
        if (disposed) {
          return;
        }

        if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
          await restoreStartupThread();
          return;
        }
        setProjectExpanded(payload.bootstrapProjectId, true);

        if (pathnameRef.current !== "/") {
          return;
        }
        if (handledBootstrapThreadIdRef.current === payload.bootstrapThreadId) {
          return;
        }
        await navigate({
          to: "/$threadId",
          params: { threadId: payload.bootstrapThreadId },
          replace: true,
        });
        handledBootstrapThreadIdRef.current = payload.bootstrapThreadId;
      })().catch(() => undefined);
    });
    // onServerConfigUpdated replays the latest cached value synchronously
    // during subscribe. Skip the toast for that replay so effect re-runs
    // don't produce duplicate toasts.
    let subscribed = false;
    const unsubServerConfigUpdated = onServerConfigUpdated((payload) => {
      void queryClient.invalidateQueries({ queryKey: serverQueryKeys.config() });
      if (!subscribed) return;
      const issue = payload.issues.find((entry) => entry.kind.startsWith("keybindings."));
      if (!issue) {
        toastManager.add({
          type: "success",
          title: "Keybindings updated",
          description: "Keybindings configuration reloaded successfully.",
        });
        return;
      }

      toastManager.add({
        type: "warning",
        title: "Invalid keybindings configuration",
        description: issue.message,
        actionProps: {
          children: "Open keybindings.json",
          onClick: () => {
            void queryClient
              .ensureQueryData(serverConfigQueryOptions())
              .then((config) => {
                const editor = resolveAndPersistPreferredEditor(config.availableEditors);
                if (!editor) {
                  throw new Error("No available editors found.");
                }
                return api.shell.openInEditor(config.keybindingsConfigPath, editor);
              })
              .catch((error) => {
                toastManager.add({
                  type: "error",
                  title: "Unable to open keybindings file",
                  description:
                    error instanceof Error ? error.message : "Unknown error opening file.",
                });
              });
          },
        },
      });
    });
    subscribed = true;
    return () => {
      disposed = true;
      needsProviderInvalidation = false;
      clearSnapshotRetry();
      domainEventFlushThrottler.cancel();
      unsubDomainEvent();
      unsubTransportState();
      unsubTerminalEvent();
      unsubWelcome();
      unsubServerConfigUpdated();
    };
  }, [
    navigate,
    queryClient,
    removeOrphanedTerminalStates,
    setProjectExpanded,
    syncServerReadModel,
  ]);

  return null;
}

function DesktopProjectBootstrap() {
  // Desktop hydration runs through EventRouter project + orchestration sync.
  return null;
}
