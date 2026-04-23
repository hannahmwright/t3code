import { Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const BrowserPushSubscriptionKeys = Schema.Struct({
  auth: TrimmedNonEmptyString,
  p256dh: TrimmedNonEmptyString,
});
export type BrowserPushSubscriptionKeys = typeof BrowserPushSubscriptionKeys.Type;

export const BrowserPushSubscription = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
  expirationTime: Schema.NullOr(Schema.Number),
  keys: BrowserPushSubscriptionKeys,
});
export type BrowserPushSubscription = typeof BrowserPushSubscription.Type;

export const NotificationsGetConfigResult = Schema.Struct({
  supported: Schema.Boolean,
  publicKey: Schema.NullOr(TrimmedNonEmptyString),
  reason: Schema.NullOr(Schema.String),
});
export type NotificationsGetConfigResult = typeof NotificationsGetConfigResult.Type;

export const NotificationsUpsertPushSubscriptionInput = Schema.Struct({
  subscription: BrowserPushSubscription,
  userAgent: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
});
export type NotificationsUpsertPushSubscriptionInput =
  typeof NotificationsUpsertPushSubscriptionInput.Type;

export const NotificationsDeletePushSubscriptionInput = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
});
export type NotificationsDeletePushSubscriptionInput =
  typeof NotificationsDeletePushSubscriptionInput.Type;
