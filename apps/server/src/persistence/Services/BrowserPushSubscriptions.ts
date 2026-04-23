import { BrowserPushSubscription, IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const BrowserPushSubscriptionRecord = Schema.Struct({
  subscription: BrowserPushSubscription,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastSuccessAt: Schema.NullOr(IsoDateTime),
  lastFailureAt: Schema.NullOr(IsoDateTime),
  lastFailureReason: Schema.NullOr(Schema.String),
});
export type BrowserPushSubscriptionRecord = typeof BrowserPushSubscriptionRecord.Type;

export const DeleteBrowserPushSubscriptionInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
});
export type DeleteBrowserPushSubscriptionInput = typeof DeleteBrowserPushSubscriptionInput.Type;

export const BrowserPushSubscriptionDeliverySuccessInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
  deliveredAt: IsoDateTime,
});
export type BrowserPushSubscriptionDeliverySuccessInput =
  typeof BrowserPushSubscriptionDeliverySuccessInput.Type;

export const BrowserPushSubscriptionDeliveryFailureInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
  failedAt: IsoDateTime,
  reason: Schema.String,
});
export type BrowserPushSubscriptionDeliveryFailureInput =
  typeof BrowserPushSubscriptionDeliveryFailureInput.Type;

export interface BrowserPushSubscriptionRepositoryShape {
  readonly upsert: (
    record: BrowserPushSubscriptionRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly list: () => Effect.Effect<
    ReadonlyArray<BrowserPushSubscriptionRecord>,
    ProjectionRepositoryError
  >;
  readonly deleteByEndpoint: (
    input: DeleteBrowserPushSubscriptionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordDeliverySuccess: (
    input: BrowserPushSubscriptionDeliverySuccessInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly recordDeliveryFailure: (
    input: BrowserPushSubscriptionDeliveryFailureInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class BrowserPushSubscriptionRepository extends ServiceMap.Service<
  BrowserPushSubscriptionRepository,
  BrowserPushSubscriptionRepositoryShape
>()("t3/persistence/Services/BrowserPushSubscriptions/BrowserPushSubscriptionRepository") {}
