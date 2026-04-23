import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      session_id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_connected_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions(expires_at)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS auth_pairing_credentials (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_auth_pairing_credentials_expires_at
    ON auth_pairing_credentials(expires_at)
  `;
});
