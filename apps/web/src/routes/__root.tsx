import {
  OrchestrationEvent,
  ThreadId,
  type ServerLifecycleWelcomePayload,
} from "@t3tools/contracts";
import {
  Outlet,
  createRootRouteWithContext,
  type ErrorComponentProps,
  useNavigate,
  useLocation,
} from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { Throttler } from "@tanstack/react-pacer";

import { APP_DISPLAY_NAME } from "../branding";
import { persistShellReadModelToBootstrapCache } from "../bootstrapCache";
import { isElectron } from "../env";
import {
  WebSocketConnectionCoordinator,
  WebSocketConnectionSurface,
} from "../components/WebSocketConnectionSurface";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { AnchoredToastProvider, ToastProvider, toastManager } from "../components/ui/toast";
import { resolveAndPersistPreferredEditor } from "../editorPreferences";
import { ensureNativeApi, readNativeApi } from "../nativeApi";
import {
  getServerConfigUpdatedNotification,
  ServerConfigUpdatedNotification,
  startServerStateSync,
  useServerConfig,
  useServerConfigUpdatedSubscription,
  useServerWelcomeSubscription,
} from "../rpc/serverState";
import {
  clearPromotedDraftThread,
  clearPromotedDraftThreads,
  useComposerDraftStore,
} from "../composerDraftStore";
import {
  deriveShellBootstrapStateFromShellReadModel,
  hydrateShellBootstrapState,
  useStore,
} from "../store";
import { useUiStateStore } from "../uiStateStore";
import { useTerminalStateStore } from "../terminalStateStore";
import { migrateLocalSettingsToServer } from "../hooks/useSettings";
import { providerQueryKeys } from "../lib/providerReactQuery";
import { projectQueryKeys } from "../lib/projectReactQuery";
import { collectActiveTerminalThreadIds } from "../lib/terminalStateCleanup";
import { deriveOrchestrationBatchEffects } from "../orchestrationEventEffects";
import { createOrchestrationRecoveryCoordinator } from "../orchestrationRecovery";
import { shouldRunForegroundSnapshotRecovery } from "../foregroundRecovery";
import { useWebNotifications } from "../hooks/useWebNotifications";
import { getWsRpcClient } from "~/wsRpcClient";
import { getOrCreateInstallationId } from "../notifications";
import {
  refreshAppAuthStatus,
  shouldWaitForDesktopAuthService,
  signInWithPassword,
  useAppAuthStatus,
} from "../appAuth";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  head: () => ({
    meta: [
      { name: "title", content: APP_DISPLAY_NAME },
      { name: "theme-color", media: "(prefers-color-scheme: light)", content: "#f8fafc" },
      { name: "theme-color", media: "(prefers-color-scheme: dark)", content: "#050816" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
    ],
    links: [
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
    ],
  }),
});

function RootRouteView() {
  const authStatus = useAppAuthStatus();
  if (!authStatus.ready) {
    return (
      <AppBootScreen
        title="Checking access"
        description="Verifying your T3 session before connecting to the server."
        statusLabel="Checking sign-in status"
      />
    );
  }

  if (!authStatus.reachable) {
    if (shouldWaitForDesktopAuthService(authStatus, isElectron)) {
      return (
        <AppBootScreen
          title="Reconnecting"
          description="Waiting for your local T3 server to finish starting."
          statusLabel="Connecting to desktop server"
        />
      );
    }
    return (
      <AppLoginScreen
        error={authStatus.error ?? "Unable to reach the auth service."}
        sessionTtlDays={authStatus.sessionTtlDays}
        onRetry={() => void refreshAppAuthStatus()}
      />
    );
  }

  if (authStatus.enabled && !authStatus.authenticated) {
    return (
      <AppLoginScreen
        error={authStatus.error}
        sessionTtlDays={authStatus.sessionTtlDays}
        onRetry={() => void refreshAppAuthStatus()}
      />
    );
  }

  if (!readNativeApi()) {
    return (
      <AppBootScreen
        title="Reconnecting"
        description="Connecting to your T3 server and restoring the current session."
        statusLabel="Preparing your workspace"
      />
    );
  }

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <ServerStateBootstrap />
        <LaunchThreadRestoreCoordinator />
        <NotificationsPresenceCoordinator />
        <NotificationsPermissionPromptCoordinator />
        <EventRouter />
        <WebSocketConnectionCoordinator />
        <WebSocketConnectionSurface>
          <AppSidebarLayout>
            <Outlet />
          </AppSidebarLayout>
        </WebSocketConnectionSurface>
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function AppLoginScreen(props: {
  error: string | null;
  sessionTtlDays: number | null;
  onRetry: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setLocalError(null);
    try {
      await signInWithPassword({
        username: username.trim(),
        password,
        remember,
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setSubmitting(false);
    }
  };

  const errorMessage = localError ?? props.error;
  const trustLabel =
    props.sessionTtlDays && props.sessionTtlDays > 0
      ? `Trust this device for ${props.sessionTtlDays} days`
      : "Keep me signed in on this device";

  return (
    <div className="relative flex min-h-[var(--app-shell-height)] items-center justify-center overflow-hidden bg-background px-4 py-8 text-foreground sm:min-h-screen sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-52 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-primary)_16%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_94%,var(--color-black))_0%,var(--background)_56%)]" />
      </div>

      <section className="relative w-full max-w-md rounded-[1.75rem] border border-border/80 bg-card/90 p-6 shadow-2xl shadow-black/20 backdrop-blur-md sm:p-7">
        <div className="flex h-18 w-18 items-center justify-center rounded-[1.4rem] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_16%,white),color-mix(in_srgb,var(--color-primary)_14%,transparent))] shadow-[0_18px_40px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]">
          <img src="/apple-touch-icon.png" alt="" className="h-11 w-11 object-contain" />
        </div>

        <p className="mt-5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Sign in directly in T3 so the PWA can stay inside the app instead of bouncing through an
          external auth sheet.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="t3-login-username">Username</Label>
            <Input
              id="t3-login-username"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="username"
              inputMode="email"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className="h-12 text-base"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="t3-login-password">Password</Label>
            <Input
              id="t3-login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-12 text-base"
            />
          </div>

          <label className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/45 px-3 py-3 text-sm">
            <Checkbox
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            <span>{trustLabel}</span>
          </label>

          {errorMessage ? (
            <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-3 text-sm text-red-100">
              {errorMessage}
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="submit"
              disabled={submitting || username.trim().length === 0 || password.length === 0}
              className="h-12 flex-1 text-base"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={props.onRetry}
              className="h-12 sm:w-auto"
            >
              Retry
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AppBootScreen(props: { title: string; description: string; statusLabel: string }) {
  return (
    <div className="relative flex min-h-[var(--app-shell-height)] items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:min-h-screen sm:px-6">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-44 bg-[radial-gradient(44rem_16rem_at_top,color-mix(in_srgb,var(--color-primary)_18%,transparent),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_92%,var(--color-white))_0%,var(--background)_56%)] dark:bg-[linear-gradient(145deg,color-mix(in_srgb,var(--background)_94%,var(--color-black))_0%,var(--background)_56%)]" />
      </div>

      <section className="relative w-full max-w-md rounded-[1.75rem] border border-border/75 bg-card/90 p-6 shadow-2xl shadow-black/10 backdrop-blur-md sm:p-7">
        <div className="flex h-18 w-18 items-center justify-center rounded-[1.4rem] bg-[linear-gradient(180deg,color-mix(in_srgb,var(--background)_18%,white),color-mix(in_srgb,var(--color-primary)_12%,transparent))] shadow-[0_18px_40px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]">
          <img
            src="/apple-touch-icon.png"
            alt=""
            className="h-11 w-11 animate-[boot-breathe_1.8s_ease-in-out_infinite] object-contain"
          />
        </div>

        <p className="mt-5 text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{props.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{props.description}</p>

        <div className="mt-6 h-2.5 overflow-hidden rounded-full bg-muted/70">
          <div className="h-full w-2/5 animate-[boot-slide_1.4s_ease-in-out_infinite] rounded-full bg-[linear-gradient(90deg,var(--color-primary),color-mix(in_srgb,var(--color-primary)_62%,white))]" />
        </div>

        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{props.statusLabel}</span>
          <span className="inline-flex gap-1" aria-hidden="true">
            <span className="h-1.5 w-1.5 animate-[boot-dot_1s_ease-in-out_infinite] rounded-full bg-primary/80" />
            <span className="h-1.5 w-1.5 animate-[boot-dot_1s_ease-in-out_0.14s_infinite] rounded-full bg-primary/80" />
            <span className="h-1.5 w-1.5 animate-[boot-dot_1s_ease-in-out_0.28s_infinite] rounded-full bg-primary/80" />
          </span>
        </div>
      </section>
    </div>
  );
}

function RootRouteErrorView({ error, reset }: ErrorComponentProps) {
  const message = errorMessage(error);
  const details = errorDetails(error);

  return (
    <div className="relative flex min-h-[var(--app-shell-height)] items-center justify-center overflow-hidden bg-background px-4 py-10 text-foreground sm:min-h-screen sm:px-6">
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

function coalesceOrchestrationUiEvents(
  events: ReadonlyArray<OrchestrationEvent>,
): OrchestrationEvent[] {
  if (events.length < 2) {
    return [...events];
  }

  const coalesced: OrchestrationEvent[] = [];
  for (const event of events) {
    const previous = coalesced.at(-1);
    if (
      previous?.type === "thread.message-sent" &&
      event.type === "thread.message-sent" &&
      previous.payload.threadId === event.payload.threadId &&
      previous.payload.messageId === event.payload.messageId
    ) {
      coalesced[coalesced.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          attachments: event.payload.attachments ?? previous.payload.attachments,
          createdAt: previous.payload.createdAt,
          text:
            !event.payload.streaming && event.payload.text.length > 0
              ? event.payload.text
              : previous.payload.text + event.payload.text,
        },
      };
      continue;
    }

    coalesced.push(event);
  }

  return coalesced;
}

const BOOTSTRAP_CACHE_REFRESH_DEBOUNCE_MS = 1_500;

function shouldRefreshBootstrapCacheForEvent(event: OrchestrationEvent): boolean {
  switch (event.type) {
    case "project.created":
    case "project.meta-updated":
    case "project.deleted":
    case "thread.created":
    case "thread.deleted":
    case "thread.archived":
    case "thread.unarchived":
    case "thread.meta-updated": {
      return true;
    }
    default: {
      return false;
    }
  }
}

function resolveActiveThreadIdFromPathname(pathname: string): ThreadId | null {
  const match = pathname.match(/^\/([^/]+)$/);
  if (!match) {
    return null;
  }

  const threadId = decodeURIComponent(match[1] ?? "");
  if (!threadId || threadId === "settings") {
    return null;
  }

  return ThreadId.makeUnsafe(threadId);
}

function resolvePreferredLaunchThreadId(params: {
  threads: ReadonlyArray<{ id: ThreadId; updatedAt: string | undefined; createdAt: string }>;
  threadLastVisitedAtById: Readonly<Record<string, string>>;
  fallbackThreadId?: string | null;
}): ThreadId | null {
  let bestThreadId: ThreadId | null = null;
  let bestVisitedAt = Number.NEGATIVE_INFINITY;
  let bestUpdatedAt = Number.NEGATIVE_INFINITY;

  for (const thread of params.threads) {
    const visitedAtRaw = params.threadLastVisitedAtById[thread.id];
    const visitedAt = Date.parse(visitedAtRaw ?? "");
    if (!Number.isFinite(visitedAt)) {
      continue;
    }
    const updatedAt = Date.parse(thread.updatedAt || thread.createdAt);
    if (visitedAt > bestVisitedAt || (visitedAt === bestVisitedAt && updatedAt > bestUpdatedAt)) {
      bestThreadId = thread.id;
      bestVisitedAt = visitedAt;
      bestUpdatedAt = updatedAt;
    }
  }

  if (bestThreadId) {
    return bestThreadId;
  }

  return params.fallbackThreadId ? ThreadId.makeUnsafe(params.fallbackThreadId) : null;
}

function ServerStateBootstrap() {
  useEffect(() => startServerStateSync(getWsRpcClient().server), []);

  return null;
}

function LaunchThreadRestoreCoordinator() {
  const bootstrapComplete = useStore((store) => store.bootstrapComplete);
  const threads = useStore((store) => store.threads);
  const threadLastVisitedAtById = useUiStateStore((store) => store.threadLastVisitedAtById);
  const pathname = useLocation({ select: (location) => location.pathname });
  const navigate = useNavigate();
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!bootstrapComplete || pathname !== "/" || restoredRef.current) {
      return;
    }

    const preferredThreadId = resolvePreferredLaunchThreadId({
      threads: threads.map((thread) => ({
        id: thread.id,
        updatedAt: thread.updatedAt,
        createdAt: thread.createdAt,
      })),
      threadLastVisitedAtById,
    });

    if (!preferredThreadId) {
      restoredRef.current = true;
      return;
    }

    restoredRef.current = true;
    void navigate({
      to: "/$threadId",
      params: { threadId: preferredThreadId },
      replace: true,
    });
  }, [bootstrapComplete, navigate, pathname, threadLastVisitedAtById, threads]);

  useEffect(() => {
    if (pathname !== "/") {
      restoredRef.current = false;
    }
  }, [pathname]);

  return null;
}

function NotificationsPresenceCoordinator() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const installationIdRef = useRef<string | null>(null);
  if (installationIdRef.current === null) {
    installationIdRef.current = getOrCreateInstallationId();
  }

  const syncPresence = useEffectEvent(() => {
    if (typeof document === "undefined") {
      return;
    }

    void ensureNativeApi()
      .server.updatePresence({
        installationId: installationIdRef.current ?? getOrCreateInstallationId(),
        activeThreadId: resolveActiveThreadIdFromPathname(pathname),
        visible: document.visibilityState === "visible",
      })
      .catch(() => undefined);
  });

  useEffect(() => {
    syncPresence();
  }, [pathname, syncPresence]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const handleVisibility = () => {
      syncPresence();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", handleVisibility);
    window.addEventListener("pagehide", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleVisibility);
      window.removeEventListener("pagehide", handleVisibility);
    };
  }, [syncPresence]);

  return null;
}

function NotificationsPermissionPromptCoordinator() {
  const { installState, permission, query, supportsBrowserPush, enable } = useWebNotifications();
  const promptToastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const handleEnableNotifications = useEffectEvent(() => {
    if (promptToastIdRef.current !== null) {
      toastManager.close(promptToastIdRef.current);
      promptToastIdRef.current = null;
    }

    void enable()
      .then(() => {
        const nextPermission = Notification.permission;
        if (nextPermission === "granted") {
          toastManager.add({
            type: "success",
            title: "Notifications enabled",
            description: "You’ll get a ping here when a turn finishes.",
            data: {
              dismissAfterVisibleMs: 8_000,
              hideCopyButton: true,
            },
          });
          return;
        }

        if (nextPermission === "denied") {
          toastManager.add({
            type: "warning",
            title: "Notifications blocked",
            description: "Enable notifications for T3 in your browser or device settings.",
            data: {
              dismissAfterVisibleMs: 10_000,
              hideCopyButton: true,
            },
          });
        }
      })
      .catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to enable notifications",
          description:
            error instanceof Error ? error.message : "Unknown error enabling notifications.",
          data: {
            dismissAfterVisibleMs: 10_000,
          },
        });
      });
  });

  useEffect(() => {
    const shouldPrompt =
      !isElectron &&
      installState.isStandalone &&
      supportsBrowserPush &&
      permission === "default" &&
      !query.isLoading &&
      query.data?.supported !== false &&
      query.data?.subscribed !== true;

    if (!shouldPrompt) {
      if (promptToastIdRef.current !== null) {
        toastManager.close(promptToastIdRef.current);
        promptToastIdRef.current = null;
      }
      return;
    }

    if (promptToastIdRef.current !== null) {
      return;
    }

    const toastId = toastManager.add({
      type: "info",
      title: "Turn on notifications",
      description: "Get a ping on this device when a turn finishes.",
      actionProps: {
        children: "Enable",
        onClick: () => handleEnableNotifications(),
      },
      data: {
        hideCopyButton: true,
      },
    });
    promptToastIdRef.current = toastId;

    return () => {
      if (promptToastIdRef.current === toastId) {
        promptToastIdRef.current = null;
      }
    };
  }, [
    installState.isStandalone,
    permission,
    query.data?.subscribed,
    query.data?.supported,
    query.isLoading,
    supportsBrowserPush,
  ]);

  return null;
}

function EventRouter() {
  const applyOrchestrationEvents = useStore((store) => store.applyOrchestrationEvents);
  const syncServerReadModel = useStore((store) => store.syncServerReadModel);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const syncProjects = useUiStateStore((store) => store.syncProjects);
  const syncThreads = useUiStateStore((store) => store.syncThreads);
  const clearThreadUi = useUiStateStore((store) => store.clearThreadUi);
  const removeTerminalState = useTerminalStateStore((store) => store.removeTerminalState);
  const removeOrphanedTerminalStates = useTerminalStateStore(
    (store) => store.removeOrphanedTerminalStates,
  );
  const applyTerminalEvent = useTerminalStateStore((store) => store.applyTerminalEvent);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (loc) => loc.pathname });
  const readPathname = useEffectEvent(() => pathname);
  const handledBootstrapThreadIdRef = useRef<string | null>(null);
  const seenServerConfigUpdateIdRef = useRef(getServerConfigUpdatedNotification()?.id ?? 0);
  const disposedRef = useRef(false);
  const bootstrapFromSnapshotRef = useRef<() => Promise<void>>(async () => undefined);
  const serverConfig = useServerConfig();

  const handleWelcome = useEffectEvent((payload: ServerLifecycleWelcomePayload | null) => {
    if (!payload) return;

    migrateLocalSettingsToServer();
    void (async () => {
      await bootstrapFromSnapshotRef.current();
      if (disposedRef.current) {
        return;
      }

      if (!payload.bootstrapProjectId || !payload.bootstrapThreadId) {
        return;
      }
      setProjectExpanded(payload.bootstrapProjectId, true);

      if (readPathname() !== "/") {
        return;
      }
      const preferredThreadId = resolvePreferredLaunchThreadId({
        threads: useStore.getState().threads.map((thread) => ({
          id: thread.id,
          updatedAt: thread.updatedAt,
          createdAt: thread.createdAt,
        })),
        threadLastVisitedAtById: useUiStateStore.getState().threadLastVisitedAtById,
        fallbackThreadId: payload.bootstrapThreadId,
      });
      if (!preferredThreadId) {
        return;
      }
      if (handledBootstrapThreadIdRef.current === preferredThreadId) {
        return;
      }
      await navigate({
        to: "/$threadId",
        params: { threadId: preferredThreadId },
        replace: true,
      });
      handledBootstrapThreadIdRef.current = preferredThreadId;
    })().catch(() => undefined);
  });

  const handleServerConfigUpdated = useEffectEvent(
    (notification: ServerConfigUpdatedNotification | null) => {
      if (!notification) return;

      const { id, payload, source } = notification;
      if (id <= seenServerConfigUpdateIdRef.current) {
        return;
      }
      seenServerConfigUpdateIdRef.current = id;
      if (source !== "keybindingsUpdated") {
        return;
      }

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
            const api = readNativeApi();
            if (!api) {
              return;
            }

            void Promise.resolve(serverConfig ?? api.server.getConfig())
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
    },
  );

  useEffect(() => {
    const api = readNativeApi();
    if (!api) return;
    let disposed = false;
    disposedRef.current = false;
    const recovery = createOrchestrationRecoveryCoordinator();
    let needsProviderInvalidation = false;
    let needsBootstrapCacheRefresh = false;
    const pendingDomainEvents: OrchestrationEvent[] = [];
    let flushPendingDomainEventsScheduled = false;
    let unsubscribeDomainEvents: (() => void) | null = null;
    let domainReconnectPromise: Promise<void> | null = null;

    const reconcileSnapshotDerivedState = () => {
      const threads = useStore.getState().threads;
      const projects = useStore.getState().projects;
      syncProjects(projects.map((project) => ({ id: project.id, cwd: project.cwd })));
      syncThreads(
        threads.map((thread) => ({
          id: thread.id,
          latestTurnCompletedAt: thread.latestTurn?.completedAt ?? undefined,
          seedVisitedAt: thread.updatedAt ?? thread.createdAt,
        })),
      );
      clearPromotedDraftThreads(threads.map((thread) => thread.id));
      const draftThreadIds = Object.keys(
        useComposerDraftStore.getState().draftThreadsByThreadId,
      ) as ThreadId[];
      const activeThreadIds = collectActiveTerminalThreadIds({
        snapshotThreads: threads.map((thread) => ({
          id: thread.id,
          deletedAt: null,
          archivedAt: thread.archivedAt,
        })),
        draftThreadIds,
      });
      removeOrphanedTerminalStates(activeThreadIds);
    };

    const queryInvalidationThrottler = new Throttler(
      () => {
        if (!needsProviderInvalidation) {
          return;
        }
        needsProviderInvalidation = false;
        void queryClient.invalidateQueries({ queryKey: providerQueryKeys.all });
        // Invalidate workspace entry queries so the @-mention file picker
        // reflects files created, deleted, or restored during this turn.
        void queryClient.invalidateQueries({ queryKey: projectQueryKeys.all });
      },
      {
        wait: 100,
        leading: false,
        trailing: true,
      },
    );
    const bootstrapCacheRefreshThrottler = new Throttler(
      () => {
        if (!needsBootstrapCacheRefresh || disposed) {
          return;
        }
        needsBootstrapCacheRefresh = false;
        void api.orchestration
          .getShellSnapshot()
          .then((snapshot) => {
            if (disposed) {
              return;
            }
            persistShellReadModelToBootstrapCache(snapshot);
          })
          .catch(() => undefined);
      },
      {
        wait: BOOTSTRAP_CACHE_REFRESH_DEBOUNCE_MS,
        leading: false,
        trailing: true,
      },
    );

    const applyEventBatch = (events: ReadonlyArray<OrchestrationEvent>) => {
      if (events.length === 0) {
        return;
      }

      const batchEffects = deriveOrchestrationBatchEffects(events);
      const uiEvents = coalesceOrchestrationUiEvents(events);
      const needsProjectUiSync = events.some(
        (event) =>
          event.type === "project.created" ||
          event.type === "project.meta-updated" ||
          event.type === "project.deleted",
      );

      if (batchEffects.needsProviderInvalidation) {
        needsProviderInvalidation = true;
        void queryInvalidationThrottler.maybeExecute();
      }
      if (events.some(shouldRefreshBootstrapCacheForEvent)) {
        needsBootstrapCacheRefresh = true;
        void bootstrapCacheRefreshThrottler.maybeExecute();
      }

      applyOrchestrationEvents(uiEvents);
      if (needsProjectUiSync) {
        const projects = useStore.getState().projects;
        syncProjects(projects.map((project) => ({ id: project.id, cwd: project.cwd })));
      }
      const needsThreadUiSync = events.some(
        (event) => event.type === "thread.created" || event.type === "thread.deleted",
      );
      if (needsThreadUiSync) {
        const threads = useStore.getState().threads;
        syncThreads(
          threads.map((thread) => ({
            id: thread.id,
            latestTurnCompletedAt: thread.latestTurn?.completedAt ?? undefined,
            seedVisitedAt: thread.updatedAt ?? thread.createdAt,
          })),
        );
      }
      const draftStore = useComposerDraftStore.getState();
      for (const threadId of batchEffects.clearPromotedDraftThreadIds) {
        clearPromotedDraftThread(threadId);
      }
      for (const threadId of batchEffects.clearDeletedThreadIds) {
        draftStore.clearDraftThread(threadId);
        clearThreadUi(threadId);
      }
      for (const threadId of batchEffects.removeTerminalStateThreadIds) {
        removeTerminalState(threadId);
      }
    };
    const requestDomainStreamReconnect = () => {
      if (disposed || domainReconnectPromise !== null) {
        return;
      }

      domainReconnectPromise = getWsRpcClient()
        .reconnect()
        .catch(() => undefined)
        .finally(() => {
          domainReconnectPromise = null;
        });
    };
    const flushPendingDomainEvents = () => {
      flushPendingDomainEventsScheduled = false;
      if (disposed || pendingDomainEvents.length === 0) {
        return;
      }

      const { bootstrapped, inFlight, latestSequence } = recovery.getState();
      if (!bootstrapped || inFlight !== null) {
        return;
      }

      const queuedEvents = pendingDomainEvents
        .filter((event) => event.sequence > latestSequence)
        .toSorted((left, right) => left.sequence - right.sequence);
      pendingDomainEvents.length = 0;
      pendingDomainEvents.push(...queuedEvents);
      if (pendingDomainEvents.length === 0) {
        return;
      }

      const nextEvents = recovery.markEventBatchApplied(pendingDomainEvents);
      if (nextEvents.length === 0) {
        requestDomainStreamReconnect();
        return;
      }

      const appliedThroughSequence = nextEvents.at(-1)?.sequence ?? latestSequence;
      const remainingEvents = pendingDomainEvents.filter(
        (event) => event.sequence > appliedThroughSequence,
      );
      pendingDomainEvents.length = 0;
      pendingDomainEvents.push(...remainingEvents);
      applyEventBatch(nextEvents);
      if (pendingDomainEvents.length > 0) {
        schedulePendingDomainEventFlush();
      }
    };
    const schedulePendingDomainEventFlush = () => {
      if (disposed || flushPendingDomainEventsScheduled) {
        return;
      }

      flushPendingDomainEventsScheduled = true;
      queueMicrotask(flushPendingDomainEvents);
    };
    const ensureDomainEventSubscription = () => {
      if (disposed || unsubscribeDomainEvents !== null) {
        return;
      }

      unsubscribeDomainEvents = api.orchestration.onDomainEvent(
        (event) => {
          const action = recovery.classifyDomainEvent(event.sequence);
          if (action === "ignore") {
            return;
          }

          pendingDomainEvents.push(event);
          schedulePendingDomainEventFlush();
        },
        {
          getFromSequenceExclusive: () => recovery.getState().latestSequence,
        },
      );
    };

    const runSnapshotRecovery = async (reason: "bootstrap" | "foreground"): Promise<void> => {
      const started = recovery.beginSnapshotRecovery(reason);
      if (import.meta.env.MODE !== "test") {
        const state = recovery.getState();
        console.info("[orchestration-recovery]", "Snapshot recovery requested.", {
          reason,
          skipped: !started,
          ...(started
            ? {}
            : {
                blockedBy: state.inFlight?.kind ?? null,
                blockedByReason: state.inFlight?.reason ?? null,
              }),
          state,
        });
      }
      if (!started) {
        return;
      }

      try {
        const snapshot = await api.orchestration.getSnapshot();
        if (!disposed) {
          syncServerReadModel(snapshot);
          reconcileSnapshotDerivedState();
          needsBootstrapCacheRefresh = true;
          void bootstrapCacheRefreshThrottler.maybeExecute();
          recovery.completeSnapshotRecovery(snapshot.snapshotSequence);
          ensureDomainEventSubscription();
          flushPendingDomainEvents();
        }
      } catch {
        // Keep prior state and wait for welcome or a later replay attempt.
        recovery.failSnapshotRecovery();
      }
    };

    const bootstrapFromShell = async (): Promise<void> => {
      const started = recovery.beginSnapshotRecovery("bootstrap");
      if (!started) {
        return;
      }
      try {
        const snapshot = await api.orchestration.getShellSnapshot();
        if (disposed) {
          recovery.failSnapshotRecovery();
          return;
        }
        useStore.setState((state) =>
          hydrateShellBootstrapState(state, deriveShellBootstrapStateFromShellReadModel(snapshot)),
        );
        persistShellReadModelToBootstrapCache(snapshot);
        reconcileSnapshotDerivedState();
        recovery.completeSnapshotRecovery(snapshot.snapshotSequence);
        ensureDomainEventSubscription();
        flushPendingDomainEvents();
      } catch {
        recovery.failSnapshotRecovery();
        await runSnapshotRecovery("bootstrap");
      }
    };
    bootstrapFromSnapshotRef.current = bootstrapFromShell;

    let lastForegroundRecoveryAtMs: number | null = null;
    let pendingBackgroundedAtMs: number | null = null;
    const markForegroundBackgrounded = () => {
      pendingBackgroundedAtMs = Date.now();
    };
    const maybeRunForegroundSnapshotRecovery = () => {
      if (
        isElectron ||
        typeof document === "undefined" ||
        typeof window === "undefined" ||
        recovery.getState().inFlight !== null
      ) {
        return;
      }

      const nowMs = Date.now();
      if (
        !shouldRunForegroundSnapshotRecovery({
          isVisible: document.visibilityState === "visible",
          pendingBackgroundedAtMs,
          lastForegroundRecoveryAtMs,
          nowMs,
        })
      ) {
        return;
      }

      pendingBackgroundedAtMs = null;
      lastForegroundRecoveryAtMs = nowMs;
      void runSnapshotRecovery("foreground");
    };
    const handleForegroundVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        markForegroundBackgrounded();
        return;
      }

      maybeRunForegroundSnapshotRecovery();
    };
    const handleForegroundFocus = () => {
      maybeRunForegroundSnapshotRecovery();
    };
    const handleForegroundPageHide = () => {
      markForegroundBackgrounded();
    };
    const handleForegroundPageShow = () => {
      maybeRunForegroundSnapshotRecovery();
    };

    if (!isElectron && typeof window !== "undefined" && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleForegroundVisibilityChange);
      window.addEventListener("focus", handleForegroundFocus);
      window.addEventListener("pagehide", handleForegroundPageHide);
      window.addEventListener("pageshow", handleForegroundPageShow);
    }
    const unsubTerminalEvent = api.terminal.onEvent((event) => {
      const thread = useStore.getState().threads.find((entry) => entry.id === event.threadId);
      if (thread && thread.archivedAt !== null) {
        return;
      }
      applyTerminalEvent(event);
    });
    return () => {
      disposed = true;
      disposedRef.current = true;
      needsProviderInvalidation = false;
      needsBootstrapCacheRefresh = false;
      flushPendingDomainEventsScheduled = false;
      pendingDomainEvents.length = 0;
      bootstrapCacheRefreshThrottler.cancel();
      queryInvalidationThrottler.cancel();
      unsubscribeDomainEvents?.();
      unsubTerminalEvent();
      if (!isElectron && typeof window !== "undefined" && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleForegroundVisibilityChange);
        window.removeEventListener("focus", handleForegroundFocus);
        window.removeEventListener("pagehide", handleForegroundPageHide);
        window.removeEventListener("pageshow", handleForegroundPageShow);
      }
    };
  }, [
    applyOrchestrationEvents,
    navigate,
    queryClient,
    removeTerminalState,
    removeOrphanedTerminalStates,
    applyTerminalEvent,
    clearThreadUi,
    setProjectExpanded,
    syncProjects,
    syncServerReadModel,
    syncThreads,
  ]);

  useServerWelcomeSubscription(handleWelcome);
  useServerConfigUpdatedSubscription(handleServerConfigUpdated);

  return null;
}
