import type { OrchestrationReadModel } from "@t3tools/contracts";
import {
  type OrchestrationEvent,
  ServerNotificationsError,
  type ServerNotificationsState,
  type ServerNotificationsStateInput,
  type ServerUpdatePresenceInput,
} from "@t3tools/contracts";
import { Clock, Effect, Layer, Option, Stream } from "effect";
import webpush from "web-push";

import { ServerConfig } from "../../config.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { PushSubscriptionRepository } from "../../persistence/Services/PushSubscriptions.ts";
import {
  NotificationsService,
  type NotificationsServiceShape,
} from "../Services/NotificationsService.ts";

const PRESENCE_STALE_AFTER_MS = 5 * 60_000;
const PUSH_PREVIEW_MAX_LENGTH = 160;

interface PresenceState {
  readonly activeThreadId: ServerUpdatePresenceInput["activeThreadId"];
  readonly visible: boolean;
  readonly updatedAtMs: number;
}

interface PushNotificationPayload {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly url: string;
  readonly threadId: string;
}

class PushDeliveryError extends Error {
  readonly statusCode: number | undefined;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : "Failed to deliver push notification.");
    this.name = "PushDeliveryError";
    this.statusCode =
      typeof cause === "object" &&
      cause !== null &&
      "statusCode" in cause &&
      typeof cause.statusCode === "number"
        ? cause.statusCode
        : undefined;
  }
}

function toNotificationsError(detail: string, cause?: unknown) {
  return new ServerNotificationsError(
    cause === undefined
      ? { detail }
      : {
          detail,
          cause,
        },
  );
}

export function normalizeNotificationText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= PUSH_PREVIEW_MAX_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, PUSH_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`;
}

export function buildNotificationPayload(
  event: Extract<OrchestrationEvent, { type: "thread.message-sent" }>,
  readModel: OrchestrationReadModel,
): PushNotificationPayload | null {
  const thread = readModel.threads.find((candidate) => candidate.id === event.payload.threadId);
  if (!thread) {
    return null;
  }

  const project = readModel.projects.find((candidate) => candidate.id === thread.projectId);
  const title = thread.title.trim() || project?.title?.trim() || "T3 Code";
  const body = normalizeNotificationText(event.payload.text);

  return {
    title,
    body: body.length > 0 ? body : "Assistant reply completed.",
    tag: `thread:${thread.id}`,
    url: `/${encodeURIComponent(thread.id)}`,
    threadId: thread.id,
  };
}

export function isCompletedAssistantReply(
  event: OrchestrationEvent,
): event is Extract<OrchestrationEvent, { type: "thread.message-sent" }> {
  return (
    event.type === "thread.message-sent" &&
    event.payload.role === "assistant" &&
    event.payload.streaming === false
  );
}

export function shouldSuppressPushForPresence(
  presence: PresenceState | undefined,
  threadId: string,
): boolean {
  if (!presence) {
    return false;
  }

  return presence.visible && presence.activeThreadId === threadId;
}

function isSubscriptionGone(error: unknown): boolean {
  if (!(error instanceof PushDeliveryError)) {
    return false;
  }

  return error.statusCode === 404 || error.statusCode === 410;
}

export const NotificationsServiceLive = Layer.effect(
  NotificationsService,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const pushSubscriptions = yield* PushSubscriptionRepository;
    const orchestrationEngine = yield* OrchestrationEngineService;
    const clock = yield* Clock.Clock;

    const presenceByInstallationId = new Map<string, PresenceState>();

    const vapidDetails =
      config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject
        ? {
            publicKey: config.vapidPublicKey,
            privateKey: config.vapidPrivateKey,
            subject: config.vapidSubject,
          }
        : null;

    const prunePresence = (nowMs: number) => {
      for (const [installationId, state] of presenceByInstallationId.entries()) {
        if (nowMs - state.updatedAtMs > PRESENCE_STALE_AFTER_MS) {
          presenceByInstallationId.delete(installationId);
        }
      }
    };

    const isForegroundedOnThread = (
      installationId: string,
      threadId: string,
      nowMs: number,
    ): boolean => {
      prunePresence(nowMs);
      const presence = presenceByInstallationId.get(installationId);
      return shouldSuppressPushForPresence(presence, threadId);
    };

    const upsertPushSubscription: NotificationsServiceShape["upsertPushSubscription"] = (input) =>
      Effect.gen(function* () {
        if (vapidDetails === null) {
          return yield* toNotificationsError("Notifications are not enabled on this server.");
        }

        const now = new Date().toISOString();
        const existing = yield* pushSubscriptions.getByInstallationId({
          installationId: input.installationId,
        }).pipe(
          Effect.mapError((cause) =>
            toNotificationsError("Failed to load existing push subscription.", cause),
          ),
        );

        yield* pushSubscriptions
          .upsert({
            installationId: input.installationId,
            subscription: input.subscription,
            userAgent: input.userAgent ?? null,
            createdAt: Option.isSome(existing) ? existing.value.createdAt : now,
            updatedAt: now,
          })
          .pipe(
            Effect.mapError((cause) =>
              toNotificationsError("Failed to save push subscription.", cause),
            ),
          );
      });

    const removePushSubscription: NotificationsServiceShape["removePushSubscription"] = (input) =>
      pushSubscriptions.deleteByInstallationId(input).pipe(
        Effect.mapError((cause) => toNotificationsError("Failed to remove push subscription.", cause)),
      );

    const updatePresence: NotificationsServiceShape["updatePresence"] = (input) =>
      Effect.gen(function* () {
        const nowMs = yield* clock.currentTimeMillis;
        prunePresence(nowMs);
        presenceByInstallationId.set(input.installationId, {
          activeThreadId: input.activeThreadId,
          visible: input.visible,
          updatedAtMs: nowMs,
        });
      });

    const deliverNotification = (
      input: {
        readonly installationId: string;
        readonly subscription: webpush.PushSubscription;
      },
      payload: PushNotificationPayload,
    ) =>
      Effect.tryPromise({
        try: () =>
          webpush.sendNotification(input.subscription, JSON.stringify(payload), {
            vapidDetails: vapidDetails ?? undefined,
            TTL: 60,
            urgency: "normal",
          }),
        catch: (cause) => new PushDeliveryError(cause),
      }).pipe(
        Effect.catch((cause) =>
          isSubscriptionGone(cause)
            ? pushSubscriptions
                .deleteByInstallationId({ installationId: input.installationId })
                .pipe(Effect.ignore)
            : Effect.logWarning("Failed to deliver push notification", {
                cause,
                installationId: input.installationId,
              }),
        ),
      );

    const notificationWorker =
      vapidDetails === null
        ? Effect.void
        : Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) =>
            !isCompletedAssistantReply(event)
              ? Effect.void
              : Effect.gen(function* () {
                  const readModel = yield* orchestrationEngine.getReadModel();
                  const payload = buildNotificationPayload(event, readModel);
                  if (!payload) {
                    return;
                  }

                  const subscriptions = yield* pushSubscriptions.listAll().pipe(
                    Effect.mapError((cause) =>
                      toNotificationsError("Failed to list push subscriptions.", cause),
                    ),
                  );
                  const nowMs = yield* clock.currentTimeMillis;

                  yield* Effect.forEach(
                    subscriptions,
                    (subscription) => {
                      if (
                        isForegroundedOnThread(
                          subscription.installationId,
                          event.payload.threadId,
                          nowMs,
                        )
                      ) {
                        return Effect.void;
                      }

                      return deliverNotification(
                        {
                          installationId: subscription.installationId,
                          subscription: subscription.subscription,
                        },
                        payload,
                      );
                    },
                    { concurrency: "unbounded", discard: true },
                  );
                }).pipe(
                  Effect.catch((cause) =>
                    Effect.logWarning("Push notification dispatch failed", {
                      cause,
                      eventType: event.type,
                      threadId: event.payload.threadId,
                    }),
                  ),
                ),
          );

    yield* Effect.forkScoped(notificationWorker);

    return {
      getState: (input: ServerNotificationsStateInput) =>
        Effect.gen(function* () {
          const existing = yield* pushSubscriptions.getByInstallationId({
            installationId: input.installationId,
          }).pipe(
            Effect.mapError((cause) =>
              toNotificationsError("Failed to load notification state.", cause),
            ),
          );

          return {
            supported: vapidDetails !== null,
            subscribed: Option.isSome(existing),
            vapidPublicKey: vapidDetails?.publicKey ?? null,
            reason:
              vapidDetails === null
                ? "Notifications are disabled until VAPID keys are configured on the server."
                : null,
          } satisfies ServerNotificationsState;
        }),
      upsertPushSubscription,
      removePushSubscription,
      updatePresence,
    } satisfies NotificationsServiceShape;
  }),
);
