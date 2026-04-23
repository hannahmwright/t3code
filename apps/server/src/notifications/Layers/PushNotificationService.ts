import type {
  BrowserPushSubscription,
  NotificationsDeletePushSubscriptionInput,
  NotificationsGetConfigResult,
  NotificationsUpsertPushSubscriptionInput,
  OrchestrationEvent,
  ThreadId,
} from "@t3tools/contracts";
import { TrimmedNonEmptyString } from "@t3tools/contracts";
import {
  buildTurnCompletionNotificationBody,
  getTurnCompletionNotificationPreview,
} from "@t3tools/shared/notifications";
import { Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import webPush from "web-push";

import { ServerConfig } from "../../config.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery";
import { BrowserPushSubscriptionRepositoryLive } from "../../persistence/Layers/BrowserPushSubscriptions.ts";
import {
  BrowserPushSubscriptionRepository,
  type BrowserPushSubscriptionRecord,
} from "../../persistence/Services/BrowserPushSubscriptions.ts";
import {
  PushNotificationService,
  PushNotificationServiceError,
  type PushNotificationServiceShape,
} from "../Services/PushNotificationService.ts";

export const DEFAULT_VAPID_SUBJECT = "mailto:notifications@t3code.app";
const VAPID_STATE_FILE_NAME = "web-push-vapid.json";

const StoredVapidConfig = Schema.Struct({
  publicKey: TrimmedNonEmptyString,
  privateKey: TrimmedNonEmptyString,
  subject: TrimmedNonEmptyString,
});
type StoredVapidConfig = typeof StoredVapidConfig.Type;

type WebPushSender = (input: {
  readonly subscription: BrowserPushSubscription;
  readonly payload: string;
  readonly vapidConfig: StoredVapidConfig;
}) => Promise<void>;

interface PushNotificationServiceOptions {
  readonly generateVapidKeys?: () => Pick<StoredVapidConfig, "publicKey" | "privateKey">;
  readonly sendNotification?: WebPushSender;
}

function toPushServiceError(message: string) {
  return (cause: unknown) => new PushNotificationServiceError({ message, cause });
}

function buildThreadUrl(threadId: ThreadId): string {
  return `/${encodeURIComponent(threadId)}`;
}

function isLoopbackHost(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  return (
    normalizedHostname === "localhost" ||
    normalizedHostname === "127.0.0.1" ||
    normalizedHostname === "[::1]" ||
    normalizedHostname === "::1"
  );
}

function hasLoopbackMailDomain(subjectUrl: URL): boolean {
  if (subjectUrl.protocol !== "mailto:") {
    return false;
  }

  const address = decodeURIComponent(subjectUrl.pathname).trim().toLowerCase();
  const atIndex = address.lastIndexOf("@");
  if (atIndex < 0) {
    return false;
  }

  const domain = address.slice(atIndex + 1);
  return isLoopbackHost(domain);
}

export function normalizeVapidSubject(rawSubject: string | undefined): string {
  const trimmed = rawSubject?.trim();
  if (!trimmed) {
    return DEFAULT_VAPID_SUBJECT;
  }

  let subjectUrl: URL;
  try {
    subjectUrl = new URL(trimmed);
  } catch {
    return DEFAULT_VAPID_SUBJECT;
  }

  if (subjectUrl.protocol !== "https:" && subjectUrl.protocol !== "mailto:") {
    return DEFAULT_VAPID_SUBJECT;
  }

  if (isLoopbackHost(subjectUrl.hostname) || hasLoopbackMailDomain(subjectUrl)) {
    return DEFAULT_VAPID_SUBJECT;
  }

  return trimmed;
}

export function withNormalizedVapidSubject(config: StoredVapidConfig): StoredVapidConfig {
  const subject = normalizeVapidSubject(config.subject);
  return subject === config.subject ? config : StoredVapidConfig.makeUnsafe({ ...config, subject });
}

function extractPushProviderResponse(cause: unknown): {
  readonly statusCode: number | undefined;
  readonly reason: string | null;
} {
  const actualCause =
    typeof cause === "object" && cause !== null && "cause" in cause ? cause.cause : cause;
  if (typeof actualCause !== "object" || actualCause === null) {
    return {
      statusCode: undefined,
      reason: null,
    };
  }

  const statusCode =
    "statusCode" in actualCause && typeof actualCause.statusCode === "number"
      ? actualCause.statusCode
      : undefined;
  const body =
    "body" in actualCause && typeof actualCause.body === "string" ? actualCause.body : null;
  if (!body) {
    return {
      statusCode,
      reason: null,
    };
  }

  try {
    const parsed = JSON.parse(body) as { reason?: unknown };
    return {
      statusCode,
      reason: typeof parsed.reason === "string" ? parsed.reason : null,
    };
  } catch {
    return {
      statusCode,
      reason: null,
    };
  }
}

export function shouldDeletePushSubscriptionAfterFailure(cause: unknown): boolean {
  const { statusCode, reason } = extractPushProviderResponse(cause);
  if (statusCode === 404 || statusCode === 410) {
    return true;
  }
  return statusCode === 400 && reason === "VapidPkHashMismatch";
}

export function shouldNotifyForTurnDiffCompletionStatus(
  status: Extract<
    Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>["payload"]["status"],
    "ready" | "missing" | "error"
  >,
): boolean {
  return status !== "missing";
}

function formatPushFailureReason(cause: unknown): string {
  const actualCause =
    typeof cause === "object" && cause !== null && "cause" in cause ? cause.cause : cause;
  const { statusCode, reason } = extractPushProviderResponse(cause);
  if (statusCode !== undefined && reason) {
    return `Push provider rejected the subscription (${statusCode}: ${reason})`;
  }
  if (actualCause instanceof Error && actualCause.message.trim().length > 0) {
    return actualCause.message;
  }
  if (statusCode !== undefined) {
    return `Push provider rejected the subscription (${statusCode})`;
  }
  return "Failed to deliver push notification.";
}

function buildNotificationPayload(input: {
  readonly event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>;
  readonly threadTitle: string | null;
  readonly projectName: string | null;
  readonly messagePreview: string | null;
}) {
  const title = input.threadTitle?.trim() || "Turn complete";
  const body = buildTurnCompletionNotificationBody({
    projectName: input.projectName,
    messagePreview: input.messagePreview,
  });

  return JSON.stringify({
    title,
    options: {
      body,
      tag: `t3code:turn-complete:${input.event.payload.threadId}`,
      renotify: true,
      badge: "/favicon-32x32.png",
      icon: "/apple-touch-icon.png",
      timestamp: Date.parse(input.event.payload.completedAt),
      data: {
        completedAt: input.event.payload.completedAt,
        threadId: input.event.payload.threadId,
        url: buildThreadUrl(input.event.payload.threadId),
      },
    },
  });
}

export const makePushNotificationServiceLive = (options: PushNotificationServiceOptions = {}) =>
  Layer.effect(
    PushNotificationService,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { stateDir } = yield* ServerConfig;
      const projectionSnapshotQuery = yield* ProjectionSnapshotQuery;
      const repository = yield* BrowserPushSubscriptionRepository;

      const generateVapidKeys =
        options.generateVapidKeys ??
        (() => {
          const { publicKey, privateKey } = webPush.generateVAPIDKeys();
          return { publicKey, privateKey };
        });
      const sendNotification =
        options.sendNotification ??
        (async ({ subscription, payload, vapidConfig }) => {
          webPush.setVapidDetails(
            vapidConfig.subject,
            vapidConfig.publicKey,
            vapidConfig.privateKey,
          );
          await webPush.sendNotification(subscription, payload);
        });

      const readStoredVapidConfig = Effect.gen(function* () {
        const filePath = path.join(stateDir, VAPID_STATE_FILE_NAME);
        const raw = yield* fileSystem
          .readFileString(filePath)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (!raw) {
          return null;
        }

        return yield* Schema.decodeUnknownEffect(StoredVapidConfig)(
          JSON.parse(raw) as unknown,
        ).pipe(Effect.mapError(toPushServiceError("Failed to decode stored web-push keys.")));
      });

      const loadOrCreateVapidConfig = Effect.gen(function* () {
        const envPublicKey = process.env.T3CODE_WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
        const envPrivateKey = process.env.T3CODE_WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
        const subject = normalizeVapidSubject(process.env.T3CODE_WEB_PUSH_VAPID_SUBJECT);

        if (envPublicKey && envPrivateKey) {
          return withNormalizedVapidSubject(
            StoredVapidConfig.makeUnsafe({
              publicKey: envPublicKey,
              privateKey: envPrivateKey,
              subject,
            }),
          );
        }

        const stored = yield* readStoredVapidConfig;
        if (stored) {
          const normalizedStored = withNormalizedVapidSubject(stored);
          if (normalizedStored.subject !== stored.subject) {
            yield* fileSystem
              .writeFileString(
                path.join(stateDir, VAPID_STATE_FILE_NAME),
                JSON.stringify(normalizedStored),
              )
              .pipe(
                Effect.mapError(toPushServiceError("Failed to persist upgraded web-push keys.")),
              );
          }
          return normalizedStored;
        }

        yield* fileSystem.makeDirectory(stateDir, { recursive: true });
        const generated = withNormalizedVapidSubject(
          StoredVapidConfig.makeUnsafe({
            ...generateVapidKeys(),
            subject,
          }),
        );
        yield* fileSystem
          .writeFileString(path.join(stateDir, VAPID_STATE_FILE_NAME), JSON.stringify(generated))
          .pipe(Effect.mapError(toPushServiceError("Failed to persist web-push keys.")));
        return generated;
      });

      const vapidConfigExit = yield* loadOrCreateVapidConfig.pipe(Effect.exit);
      if (Exit.isFailure(vapidConfigExit)) {
        yield* Effect.logWarning("web-push disabled", {
          cause: vapidConfigExit.cause,
        });
      }

      const getReadyVapidConfig = () => {
        if (Exit.isFailure(vapidConfigExit)) {
          return Effect.fail(
            new PushNotificationServiceError({
              message: "Web push is unavailable on this server.",
            }),
          );
        }
        return Effect.succeed(vapidConfigExit.value);
      };

      const getConfig: PushNotificationServiceShape["getConfig"] = () =>
        Effect.succeed(
          Exit.match(vapidConfigExit, {
            onFailure: (): NotificationsGetConfigResult => ({
              supported: false,
              publicKey: null,
              reason: "Web push is unavailable on this server.",
            }),
            onSuccess: (vapidConfig): NotificationsGetConfigResult => ({
              supported: true,
              publicKey: vapidConfig.publicKey,
              reason: null,
            }),
          }),
        );

      const upsertPushSubscription: PushNotificationServiceShape["upsertPushSubscription"] = (
        input: NotificationsUpsertPushSubscriptionInput,
      ) =>
        Effect.gen(function* () {
          yield* getReadyVapidConfig();
          const now = new Date().toISOString();
          yield* repository.upsert({
            subscription: input.subscription,
            userAgent: input.userAgent ?? null,
            createdAt: now,
            updatedAt: now,
            lastSuccessAt: null,
            lastFailureAt: null,
            lastFailureReason: null,
          });
        }).pipe(
          Effect.mapError(
            toPushServiceError("Failed to register this browser for push notifications."),
          ),
        );

      const deletePushSubscription: PushNotificationServiceShape["deletePushSubscription"] = (
        input: NotificationsDeletePushSubscriptionInput,
      ) =>
        repository
          .deleteByEndpoint(input)
          .pipe(
            Effect.mapError(toPushServiceError("Failed to remove this browser push subscription.")),
          );

      const notifyTurnCompleted: PushNotificationServiceShape["notifyTurnCompleted"] = (
        event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
      ) =>
        Effect.gen(function* () {
          if (!shouldNotifyForTurnDiffCompletionStatus(event.payload.status)) {
            return;
          }
          if (Exit.isFailure(vapidConfigExit)) {
            return;
          }
          const vapidConfig = vapidConfigExit.value;

          const subscriptions = yield* repository
            .list()
            .pipe(
              Effect.mapError(toPushServiceError("Failed to read browser push subscriptions.")),
            );
          if (subscriptions.length === 0) {
            return;
          }

          const snapshot = yield* projectionSnapshotQuery
            .getSnapshot()
            .pipe(Effect.catch(() => Effect.succeed(null)));
          const thread =
            snapshot?.threads.find((candidate) => candidate.id === event.payload.threadId) ?? null;
          const project =
            thread === null
              ? null
              : (snapshot?.projects.find((candidate) => candidate.id === thread.projectId) ?? null);

          const payload = buildNotificationPayload({
            event,
            threadTitle: thread?.title ?? null,
            projectName: project?.title ?? null,
            messagePreview:
              thread === null
                ? null
                : getTurnCompletionNotificationPreview({
                    messages: thread.messages,
                    turnId: event.payload.turnId,
                  }),
          });

          yield* Effect.forEach(
            subscriptions,
            (record: BrowserPushSubscriptionRecord) =>
              Effect.tryPromise({
                try: () =>
                  sendNotification({
                    subscription: record.subscription,
                    payload,
                    vapidConfig,
                  }),
                catch: (cause) =>
                  new PushNotificationServiceError({
                    message: formatPushFailureReason(cause),
                    cause,
                  }),
              }).pipe(
                Effect.flatMap(() =>
                  repository.recordDeliverySuccess({
                    endpoint: record.subscription.endpoint,
                    deliveredAt: new Date().toISOString(),
                  }),
                ),
                Effect.catch((error) => {
                  if (shouldDeletePushSubscriptionAfterFailure(error)) {
                    return repository
                      .deleteByEndpoint({
                        endpoint: record.subscription.endpoint,
                      })
                      .pipe(
                        Effect.tap(() =>
                          Effect.logWarning("removed stale browser push subscription", {
                            endpoint: record.subscription.endpoint,
                            reason: formatPushFailureReason(error),
                          }),
                        ),
                        Effect.ignore,
                      );
                  }

                  return repository
                    .recordDeliveryFailure({
                      endpoint: record.subscription.endpoint,
                      failedAt: new Date().toISOString(),
                      reason: formatPushFailureReason(error),
                    })
                    .pipe(
                      Effect.tap(() =>
                        Effect.logWarning("browser push delivery failed", {
                          endpoint: record.subscription.endpoint,
                          cause: error,
                        }),
                      ),
                      Effect.ignore,
                    );
                }),
              ),
            { concurrency: "unbounded", discard: true },
          );
        });

      return {
        getConfig,
        upsertPushSubscription,
        deletePushSubscription,
        notifyTurnCompleted,
      } satisfies PushNotificationServiceShape;
    }),
  ).pipe(Layer.provide(BrowserPushSubscriptionRepositoryLive));

export const PushNotificationServiceLive = makePushNotificationServiceLive();
