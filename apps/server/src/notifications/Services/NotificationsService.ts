import type {
  ServerNotificationsState,
  ServerNotificationsStateInput,
  ServerRemovePushSubscriptionInput,
  ServerUpdatePresenceInput,
  ServerUpsertPushSubscriptionInput,
} from "@t3tools/contracts";
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ServerNotificationsError } from "@t3tools/contracts";

export interface NotificationsServiceShape {
  readonly getState: (
    input: ServerNotificationsStateInput,
  ) => Effect.Effect<ServerNotificationsState, ServerNotificationsError>;
  readonly upsertPushSubscription: (
    input: ServerUpsertPushSubscriptionInput,
  ) => Effect.Effect<void, ServerNotificationsError>;
  readonly removePushSubscription: (
    input: ServerRemovePushSubscriptionInput,
  ) => Effect.Effect<void, ServerNotificationsError>;
  readonly updatePresence: (
    input: ServerUpdatePresenceInput,
  ) => Effect.Effect<void, ServerNotificationsError>;
}

export class NotificationsService extends ServiceMap.Service<
  NotificationsService,
  NotificationsServiceShape
>()("t3/notifications/Services/NotificationsService") {}
