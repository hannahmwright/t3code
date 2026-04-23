import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableInfoRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS browser_push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      expiration_time REAL,
      p256dh_key TEXT NOT NULL,
      auth_key TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_success_at TEXT,
      last_failure_at TEXT,
      last_failure_reason TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_browser_push_subscriptions_updated_at
    ON browser_push_subscriptions(updated_at)
  `;

  const pushSubscriptionColumns = yield* sql<TableInfoRow>`PRAGMA table_info(push_subscriptions)`;
  if (pushSubscriptionColumns.length === 0) {
    return;
  }

  yield* sql`
    INSERT OR IGNORE INTO browser_push_subscriptions (
      endpoint,
      expiration_time,
      p256dh_key,
      auth_key,
      user_agent,
      created_at,
      updated_at
    )
    SELECT
      json_extract(subscription_json, '$.endpoint'),
      json_extract(subscription_json, '$.expirationTime'),
      json_extract(subscription_json, '$.keys.p256dh'),
      json_extract(subscription_json, '$.keys.auth'),
      user_agent,
      created_at,
      updated_at
    FROM push_subscriptions
    WHERE json_type(subscription_json, '$.endpoint') = 'text'
      AND json_type(subscription_json, '$.keys.p256dh') = 'text'
      AND json_type(subscription_json, '$.keys.auth') = 'text'
  `;
});
