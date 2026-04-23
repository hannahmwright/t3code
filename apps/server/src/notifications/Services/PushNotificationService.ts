import type {
  NotificationsDeletePushSubscriptionInput,
  NotificationsGetConfigResult,
  NotificationsUpsertPushSubscriptionInput,
  OrchestrationEvent,
} from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

export class PushNotificationServiceError extends Schema.TaggedErrorClass<PushNotificationServiceError>()(
  "PushNotificationServiceError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect),
  },
) {}

export interface PushNotificationServiceShape {
  readonly getConfig: () => Effect.Effect<NotificationsGetConfigResult>;
  readonly upsertPushSubscription: (
    input: NotificationsUpsertPushSubscriptionInput,
  ) => Effect.Effect<void, PushNotificationServiceError>;
  readonly deletePushSubscription: (
    input: NotificationsDeletePushSubscriptionInput,
  ) => Effect.Effect<void, PushNotificationServiceError>;
  readonly notifyTurnCompleted: (
    event: Extract<OrchestrationEvent, { type: "thread.turn-diff-completed" }>,
  ) => Effect.Effect<void, PushNotificationServiceError>;
}

export class PushNotificationService extends ServiceMap.Service<
  PushNotificationService,
  PushNotificationServiceShape
>()("t3/notifications/Services/PushNotificationService") {}
