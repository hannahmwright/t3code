import { IsoDateTime, ServerInstallationId, ServerPushSubscription } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { PushSubscriptionRepositoryError } from "../Errors.ts";

export const PushSubscriptionRecord = Schema.Struct({
  installationId: ServerInstallationId,
  subscription: ServerPushSubscription,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PushSubscriptionRecord = typeof PushSubscriptionRecord.Type;

export const GetPushSubscriptionByInstallationIdInput = Schema.Struct({
  installationId: ServerInstallationId,
});
export type GetPushSubscriptionByInstallationIdInput =
  typeof GetPushSubscriptionByInstallationIdInput.Type;

export const DeletePushSubscriptionByInstallationIdInput = Schema.Struct({
  installationId: ServerInstallationId,
});
export type DeletePushSubscriptionByInstallationIdInput =
  typeof DeletePushSubscriptionByInstallationIdInput.Type;

export interface PushSubscriptionRepositoryShape {
  readonly upsert: (
    row: PushSubscriptionRecord,
  ) => Effect.Effect<void, PushSubscriptionRepositoryError>;
  readonly getByInstallationId: (
    input: GetPushSubscriptionByInstallationIdInput,
  ) => Effect.Effect<Option.Option<PushSubscriptionRecord>, PushSubscriptionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<PushSubscriptionRecord>,
    PushSubscriptionRepositoryError
  >;
  readonly deleteByInstallationId: (
    input: DeletePushSubscriptionByInstallationIdInput,
  ) => Effect.Effect<void, PushSubscriptionRepositoryError>;
}

export class PushSubscriptionRepository extends ServiceMap.Service<
  PushSubscriptionRepository,
  PushSubscriptionRepositoryShape
>()("t3/persistence/Services/PushSubscriptions/PushSubscriptionRepository") {}
