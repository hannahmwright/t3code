import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

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
});
