import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const hasColumn = (columns: ReadonlyArray<{ readonly name: string }>, name: string): boolean =>
  columns.some((column) => column.name === name);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const pairingColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_pairing_links)
  `;
  const pairingSchemaIsCompatible =
    hasColumn(pairingColumns, "credential") &&
    hasColumn(pairingColumns, "method") &&
    hasColumn(pairingColumns, "consumed_at") &&
    hasColumn(pairingColumns, "revoked_at");

  if (!pairingSchemaIsCompatible) {
    yield* sql`
      DROP TABLE IF EXISTS auth_pairing_links_pre_compat_36
    `;
    yield* sql`
      ALTER TABLE auth_pairing_links
      RENAME TO auth_pairing_links_pre_compat_36
    `.pipe(Effect.catch(() => Effect.void));
    yield* sql`
      CREATE TABLE IF NOT EXISTS auth_pairing_links (
        id TEXT PRIMARY KEY,
        credential TEXT NOT NULL UNIQUE,
        method TEXT NOT NULL,
        role TEXT NOT NULL,
        subject TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        revoked_at TEXT
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_auth_pairing_links_active
      ON auth_pairing_links(revoked_at, consumed_at, expires_at)
    `;
  }

  const sessionColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(auth_sessions)
  `;
  const sessionSchemaIsCompatible =
    !hasColumn(sessionColumns, "token_hash") &&
    hasColumn(sessionColumns, "method") &&
    hasColumn(sessionColumns, "issued_at") &&
    hasColumn(sessionColumns, "revoked_at");

  if (!sessionSchemaIsCompatible) {
    yield* sql`
      DROP TABLE IF EXISTS auth_sessions_pre_compat_36
    `;
    yield* sql`
      ALTER TABLE auth_sessions
      RENAME TO auth_sessions_pre_compat_36
    `.pipe(Effect.catch(() => Effect.void));
    yield* sql`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        role TEXT NOT NULL,
        method TEXT NOT NULL,
        client_label TEXT,
        client_ip_address TEXT,
        client_user_agent TEXT,
        client_device_type TEXT NOT NULL DEFAULT 'unknown',
        client_os TEXT,
        client_browser TEXT,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_connected_at TEXT,
        revoked_at TEXT
      )
    `;
    yield* sql`
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_active
      ON auth_sessions(revoked_at, expires_at, issued_at)
    `;
  }
});
