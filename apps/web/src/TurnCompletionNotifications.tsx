import { type ThreadId } from "@t3tools/contracts";
import {
  buildTurnCompletionNotificationBody,
  getTurnCompletionNotificationPreview,
} from "@t3tools/shared/notifications";
import { useEffect, useMemo, useRef } from "react";

import { useAppSettings } from "./appSettings";
import {
  ensureNotificationServiceWorkerRegistration,
  isBrowserPushSupported,
  removeBrowserPushSubscription,
  showAppNotification,
  subscribeToBrowserPush,
  type AppNotificationInput,
} from "./browserNotifications";
import { toastManager } from "./components/ui/toast";
import { isElectron } from "./env";
import { readNativeApi } from "./nativeApi";
import { resolvePrimaryEnvironmentHttpBaseUrl } from "./primaryEnvironment";
import { formatElapsed, isLatestTurnSettled } from "./session-logic";
import { useStore } from "./store";
import type { Project, Thread } from "./types";
import { useBrowserNotificationPermission } from "./useBrowserNotificationPermission";

interface TurnCompletionNotificationCandidate {
  readonly key: string;
  readonly completedAtMs: number;
  readonly threadTitle: string;
  readonly notification: AppNotificationInput & {
    readonly url: string;
  };
}

export function buildThreadNotificationUrl(threadId: ThreadId, origin: string): string {
  return new URL(`/${encodeURIComponent(threadId)}`, origin).toString();
}

export function getTurnCompletionNotificationCandidate(input: {
  readonly thread: Thread;
  readonly project: Project | null;
  readonly origin: string;
}): TurnCompletionNotificationCandidate | null {
  const { thread, project, origin } = input;
  if (!isLatestTurnSettled(thread.latestTurn, thread.session)) {
    return null;
  }

  const latestTurn = thread.latestTurn;
  if (!latestTurn?.turnId || !latestTurn.completedAt) {
    return null;
  }
  if (latestTurn.state !== "completed" && latestTurn.state !== "error") {
    return null;
  }
  if (!latestTurn.startedAt) {
    return null;
  }

  const completedAtMs = Date.parse(latestTurn.completedAt);
  if (Number.isNaN(completedAtMs)) {
    return null;
  }

  const duration = formatElapsed(latestTurn.startedAt, latestTurn.completedAt);
  const messagePreview = getTurnCompletionNotificationPreview({
    messages: thread.messages,
    turnId: latestTurn.turnId,
  });

  return {
    key: `${latestTurn.turnId}:${latestTurn.completedAt}`,
    completedAtMs,
    threadTitle: thread.title.trim() || "Turn complete",
    notification: {
      title: thread.title.trim() || "Turn complete",
      body: buildTurnCompletionNotificationBody({
        projectName: project?.name ?? null,
        messagePreview,
        detail: duration ? `Worked for ${duration}` : null,
      }),
      tag: `t3code:turn-complete:${thread.id}`,
      renotify: true,
      url: buildThreadNotificationUrl(thread.id, origin),
    },
  };
}

export function buildTurnCompletionNotification(input: {
  readonly candidates: ReadonlyArray<TurnCompletionNotificationCandidate>;
}): AppNotificationInput | null {
  if (input.candidates.length === 0) {
    return null;
  }

  const sorted = [...input.candidates].toSorted(
    (left, right) => left.completedAtMs - right.completedAtMs,
  );
  const latest = sorted.at(-1);
  if (!latest) {
    return null;
  }

  if (sorted.length === 1) {
    return latest.notification;
  }

  return {
    title: `${sorted.length} turns finished`,
    body: latest.threadTitle,
    tag: "t3code:turn-complete:batch",
    renotify: true,
    url: latest.notification.url,
  };
}

export function TurnCompletionNotifications() {
  const threads = useStore((store) => store.threads);
  const projects = useStore((store) => store.projects);
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const { settings, updateSettings } = useAppSettings();
  const { permission, supported, requestPermission } = useBrowserNotificationPermission();
  const previousCompletionKeyByThreadIdRef = useRef(new Map<ThreadId, string | null>());
  const initializedRef = useRef(false);
  const permissionPromptShownRef = useRef(false);
  const permissionToastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const remotePushReadyRef = useRef(false);
  const remotePushEndpointRef = useRef<string | null>(null);

  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project] as const)),
    [projects],
  );

  useEffect(() => {
    if (isElectron || !supported) {
      return;
    }
    void ensureNotificationServiceWorkerRegistration();
  }, [supported]);

  useEffect(() => {
    if (
      isElectron ||
      !supported ||
      !settings.enableTurnCompletionNotifications ||
      permission !== "default"
    ) {
      if (permissionToastIdRef.current !== null) {
        toastManager.close(permissionToastIdRef.current);
        permissionToastIdRef.current = null;
      }
      return;
    }

    if (permissionPromptShownRef.current) {
      return;
    }
    permissionPromptShownRef.current = true;

    permissionToastIdRef.current = toastManager.add({
      type: "info",
      title: "Enable notifications",
      description: "Get alerted when a turn finishes while T3 Code is in the background.",
      timeout: 0,
      actionProps: {
        children: "Enable",
        onClick: () => {
          if (permissionToastIdRef.current !== null) {
            toastManager.close(permissionToastIdRef.current);
            permissionToastIdRef.current = null;
          }
          void requestPermission()
            .then((nextPermission) => {
              if (nextPermission === "granted") {
                toastManager.add({
                  type: "success",
                  title: "Notifications enabled",
                  description: "You’ll get an alert when a turn finishes in the background.",
                });
                return;
              }

              if (nextPermission === "denied") {
                updateSettings({ enableTurnCompletionNotifications: false });
                toastManager.add({
                  type: "warning",
                  title: "Notifications blocked",
                  description:
                    "Allow notifications in your browser settings, then turn this back on.",
                });
              }
            })
            .catch(() => {
              toastManager.add({
                type: "error",
                title: "Notifications unavailable",
                description: "T3 Code couldn’t enable browser notifications just now.",
              });
            });
        },
      },
    });
  }, [
    permission,
    requestPermission,
    settings.enableTurnCompletionNotifications,
    supported,
    updateSettings,
  ]);

  useEffect(() => {
    remotePushReadyRef.current = false;

    if (isElectron || !supported || !isBrowserPushSupported()) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const api = readNativeApi();
      if (!api) {
        return;
      }

      if (!settings.enableTurnCompletionNotifications || permission !== "granted") {
        const endpoint =
          remotePushEndpointRef.current ??
          (await removeBrowserPushSubscription().catch(() => null));
        remotePushEndpointRef.current = null;
        if (endpoint) {
          await api.notifications.deletePushSubscription({ endpoint }).catch(() => undefined);
        }
        return;
      }

      const config = await api.notifications.getConfig().catch(() => null);
      if (!config?.supported || !config.publicKey) {
        return;
      }

      const subscription = await subscribeToBrowserPush(config.publicKey).catch(() => null);
      if (!subscription) {
        return;
      }

      await api.notifications
        .upsertPushSubscription({
          subscription,
          userAgent: navigator.userAgent ?? null,
        })
        .catch(() => undefined);
      if (cancelled) {
        return;
      }

      remotePushEndpointRef.current = subscription.endpoint;
      remotePushReadyRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [permission, settings.enableTurnCompletionNotifications, supported]);

  useEffect(() => {
    if (!threadsHydrated) {
      previousCompletionKeyByThreadIdRef.current.clear();
      initializedRef.current = false;
      return;
    }
    if (typeof window === "undefined") {
      return;
    }

    const nextCompletionKeyByThreadId = new Map<ThreadId, string | null>();
    const candidates = threads.flatMap((thread) => {
      const candidate = getTurnCompletionNotificationCandidate({
        thread,
        project: projectsById.get(thread.projectId) ?? null,
        origin: resolvePrimaryEnvironmentHttpBaseUrl(),
      });
      nextCompletionKeyByThreadId.set(thread.id, candidate?.key ?? null);

      const previousKey = previousCompletionKeyByThreadIdRef.current.get(thread.id) ?? null;
      return initializedRef.current && candidate && candidate.key !== previousKey
        ? [candidate]
        : [];
    });

    previousCompletionKeyByThreadIdRef.current = nextCompletionKeyByThreadId;
    if (!initializedRef.current) {
      initializedRef.current = true;
      return;
    }

    if (
      isElectron ||
      !settings.enableTurnCompletionNotifications ||
      permission !== "granted" ||
      remotePushReadyRef.current ||
      typeof document === "undefined" ||
      !document.hidden
    ) {
      return;
    }

    const notification = buildTurnCompletionNotification({ candidates });
    if (!notification) {
      return;
    }

    void showAppNotification(notification);
  }, [
    permission,
    projectsById,
    settings.enableTurnCompletionNotifications,
    threads,
    threadsHydrated,
  ]);

  return null;
}
