import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema, Struct } from "effect";

import { ServerPushSubscription } from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeletePushSubscriptionByInstallationIdInput,
  GetPushSubscriptionByInstallationIdInput,
  PushSubscriptionRecord,
  PushSubscriptionRepository,
  type PushSubscriptionRepositoryShape,
} from "../Services/PushSubscriptions.ts";

const PushSubscriptionRecordDbRow = PushSubscriptionRecord.mapFields(
  Struct.assign({
    subscription: Schema.fromJsonString(ServerPushSubscription),
  }),
);
type PushSubscriptionRecordDbRow = typeof PushSubscriptionRecordDbRow.Type;

const makePushSubscriptionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertPushSubscriptionRow = SqlSchema.void({
    Request: PushSubscriptionRecord,
    execute: (row) =>
      sql`
        INSERT INTO push_subscriptions (
          installation_id,
          subscription_json,
          user_agent,
          created_at,
          updated_at
        )
        VALUES (
          ${row.installationId},
          ${JSON.stringify(row.subscription)},
          ${row.userAgent},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (installation_id)
        DO UPDATE SET
          subscription_json = excluded.subscription_json,
          user_agent = excluded.user_agent,
          updated_at = excluded.updated_at
      `,
  });

  const getPushSubscriptionRow = SqlSchema.findOneOption({
    Request: GetPushSubscriptionByInstallationIdInput,
    Result: PushSubscriptionRecordDbRow,
    execute: ({ installationId }) =>
      sql`
        SELECT
          installation_id AS "installationId",
          subscription_json AS "subscription",
          user_agent AS "userAgent",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM push_subscriptions
        WHERE installation_id = ${installationId}
      `,
  });

  const listPushSubscriptionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: PushSubscriptionRecordDbRow,
    execute: () =>
      sql`
        SELECT
          installation_id AS "installationId",
          subscription_json AS "subscription",
          user_agent AS "userAgent",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM push_subscriptions
        ORDER BY created_at ASC, installation_id ASC
      `,
  });

  const deletePushSubscriptionRow = SqlSchema.void({
    Request: DeletePushSubscriptionByInstallationIdInput,
    execute: ({ installationId }) =>
      sql`
        DELETE FROM push_subscriptions
        WHERE installation_id = ${installationId}
      `,
  });

  const upsert: PushSubscriptionRepositoryShape["upsert"] = (row) =>
    upsertPushSubscriptionRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("PushSubscriptionRepository.upsert:query")),
    );

  const getByInstallationId: PushSubscriptionRepositoryShape["getByInstallationId"] = (input) =>
    getPushSubscriptionRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("PushSubscriptionRepository.getByInstallationId:query")),
    );

  const listAll: PushSubscriptionRepositoryShape["listAll"] = () =>
    listPushSubscriptionRows().pipe(
      Effect.mapError(toPersistenceSqlError("PushSubscriptionRepository.listAll:query")),
    );

  const deleteByInstallationId: PushSubscriptionRepositoryShape["deleteByInstallationId"] = (
    input,
  ) =>
    deletePushSubscriptionRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("PushSubscriptionRepository.deleteByInstallationId:query"),
      ),
    );

  return {
    upsert,
    getByInstallationId,
    listAll,
    deleteByInstallationId,
  } satisfies PushSubscriptionRepositoryShape;
});

export const PushSubscriptionRepositoryLive = Layer.effect(
  PushSubscriptionRepository,
  makePushSubscriptionRepository,
);
