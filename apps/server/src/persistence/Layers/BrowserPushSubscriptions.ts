import { BrowserPushSubscription, IsoDateTime, TrimmedNonEmptyString } from "@t3tools/contracts";
import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  BrowserPushSubscriptionDeliveryFailureInput,
  BrowserPushSubscriptionDeliverySuccessInput,
  BrowserPushSubscriptionRecord,
  BrowserPushSubscriptionRepository,
  type BrowserPushSubscriptionRepositoryShape,
  DeleteBrowserPushSubscriptionInput,
} from "../Services/BrowserPushSubscriptions.ts";

const BrowserPushSubscriptionDbRowSchema = Schema.Struct({
  endpoint: TrimmedNonEmptyString,
  expirationTime: Schema.NullOr(Schema.Number),
  p256dh: TrimmedNonEmptyString,
  auth: TrimmedNonEmptyString,
  userAgent: Schema.NullOr(Schema.String),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  lastSuccessAt: Schema.NullOr(IsoDateTime),
  lastFailureAt: Schema.NullOr(IsoDateTime),
  lastFailureReason: Schema.NullOr(Schema.String),
});

const decodeRecord = Schema.decodeUnknownEffect(BrowserPushSubscriptionRecord);

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeBrowserPushSubscriptionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertBrowserPushSubscription = SqlSchema.void({
    Request: BrowserPushSubscriptionRecord,
    execute: (record) =>
      sql`
        INSERT INTO browser_push_subscriptions (
          endpoint,
          expiration_time,
          p256dh_key,
          auth_key,
          user_agent,
          created_at,
          updated_at,
          last_success_at,
          last_failure_at,
          last_failure_reason
        )
        VALUES (
          ${record.subscription.endpoint},
          ${record.subscription.expirationTime},
          ${record.subscription.keys.p256dh},
          ${record.subscription.keys.auth},
          ${record.userAgent},
          ${record.createdAt},
          ${record.updatedAt},
          ${record.lastSuccessAt},
          ${record.lastFailureAt},
          ${record.lastFailureReason}
        )
        ON CONFLICT (endpoint)
        DO UPDATE SET
          expiration_time = excluded.expiration_time,
          p256dh_key = excluded.p256dh_key,
          auth_key = excluded.auth_key,
          user_agent = excluded.user_agent,
          updated_at = excluded.updated_at
      `,
  });

  const listBrowserPushSubscriptions = SqlSchema.findAll({
    Request: Schema.Void,
    Result: BrowserPushSubscriptionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          endpoint,
          expiration_time AS "expirationTime",
          p256dh_key AS "p256dh",
          auth_key AS "auth",
          user_agent AS "userAgent",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          last_success_at AS "lastSuccessAt",
          last_failure_at AS "lastFailureAt",
          last_failure_reason AS "lastFailureReason"
        FROM browser_push_subscriptions
        ORDER BY updated_at ASC, endpoint ASC
      `,
  });

  const deleteBrowserPushSubscriptionByEndpoint = SqlSchema.void({
    Request: DeleteBrowserPushSubscriptionInput,
    execute: ({ endpoint }) =>
      sql`
        DELETE FROM browser_push_subscriptions
        WHERE endpoint = ${endpoint}
      `,
  });

  const recordBrowserPushDeliverySuccess = SqlSchema.void({
    Request: BrowserPushSubscriptionDeliverySuccessInput,
    execute: ({ endpoint, deliveredAt }) =>
      sql`
        UPDATE browser_push_subscriptions
        SET
          updated_at = ${deliveredAt},
          last_success_at = ${deliveredAt},
          last_failure_at = NULL,
          last_failure_reason = NULL
        WHERE endpoint = ${endpoint}
      `,
  });

  const recordBrowserPushDeliveryFailure = SqlSchema.void({
    Request: BrowserPushSubscriptionDeliveryFailureInput,
    execute: ({ endpoint, failedAt, reason }) =>
      sql`
        UPDATE browser_push_subscriptions
        SET
          updated_at = ${failedAt},
          last_failure_at = ${failedAt},
          last_failure_reason = ${reason}
        WHERE endpoint = ${endpoint}
      `,
  });

  const upsert: BrowserPushSubscriptionRepositoryShape["upsert"] = (record) =>
    upsertBrowserPushSubscription(record).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "BrowserPushSubscriptionRepository.upsert:query",
          "BrowserPushSubscriptionRepository.upsert:encodeRequest",
        ),
      ),
    );

  const list: BrowserPushSubscriptionRepositoryShape["list"] = () =>
    listBrowserPushSubscriptions(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "BrowserPushSubscriptionRepository.list:query",
          "BrowserPushSubscriptionRepository.list:decodeRows",
        ),
      ),
      Effect.flatMap((rows) =>
        Effect.forEach(
          rows,
          (row) =>
            decodeRecord({
              subscription: BrowserPushSubscription.makeUnsafe({
                endpoint: row.endpoint,
                expirationTime: row.expirationTime,
                keys: {
                  auth: row.auth,
                  p256dh: row.p256dh,
                },
              }),
              userAgent: row.userAgent,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              lastSuccessAt: row.lastSuccessAt,
              lastFailureAt: row.lastFailureAt,
              lastFailureReason: row.lastFailureReason,
            }).pipe(
              Effect.mapError(
                toPersistenceDecodeError("BrowserPushSubscriptionRepository.list:rowToRecord"),
              ),
            ),
          { concurrency: "unbounded" },
        ),
      ),
    );

  const deleteByEndpoint: BrowserPushSubscriptionRepositoryShape["deleteByEndpoint"] = (input) =>
    deleteBrowserPushSubscriptionByEndpoint(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("BrowserPushSubscriptionRepository.deleteByEndpoint:query"),
      ),
    );

  const recordDeliverySuccess: BrowserPushSubscriptionRepositoryShape["recordDeliverySuccess"] = (
    input,
  ) =>
    recordBrowserPushDeliverySuccess(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "BrowserPushSubscriptionRepository.recordDeliverySuccess:query",
          "BrowserPushSubscriptionRepository.recordDeliverySuccess:encodeRequest",
        ),
      ),
    );

  const recordDeliveryFailure: BrowserPushSubscriptionRepositoryShape["recordDeliveryFailure"] = (
    input,
  ) =>
    recordBrowserPushDeliveryFailure(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "BrowserPushSubscriptionRepository.recordDeliveryFailure:query",
          "BrowserPushSubscriptionRepository.recordDeliveryFailure:encodeRequest",
        ),
      ),
    );

  return {
    upsert,
    list,
    deleteByEndpoint,
    recordDeliverySuccess,
    recordDeliveryFailure,
  } satisfies BrowserPushSubscriptionRepositoryShape;
});

export const BrowserPushSubscriptionRepositoryLive = Layer.effect(
  BrowserPushSubscriptionRepository,
  makeBrowserPushSubscriptionRepository,
);
