import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  AuthPairingCredentialRecord,
  AuthSessionRecord,
  AuthSessionRepository,
  type AuthSessionRepositoryShape,
  FindAuthSessionByTokenHashInput,
  FindPairingCredentialByTokenHashInput,
  MarkPairingCredentialUsedInput,
  TouchAuthSessionInput,
} from "../Services/AuthSessions.ts";

const AuthSessionDbRowSchema = Schema.Struct({
  sessionId: Schema.String,
  tokenHash: Schema.String,
  subject: Schema.String,
  role: Schema.Literals(["owner", "client"]),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  lastConnectedAt: Schema.NullOr(Schema.String),
});

const AuthPairingCredentialDbRowSchema = Schema.Struct({
  id: Schema.String,
  tokenHash: Schema.String,
  subject: Schema.String,
  role: Schema.Literals(["owner", "client"]),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  usedAt: Schema.NullOr(Schema.String),
});

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeAuthSessionRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertSessionQuery = SqlSchema.void({
    Request: AuthSessionRecord,
    execute: (record) =>
      sql`
        INSERT INTO auth_sessions (
          session_id,
          token_hash,
          subject,
          role,
          created_at,
          expires_at,
          last_connected_at
        )
        VALUES (
          ${record.sessionId},
          ${record.tokenHash},
          ${record.subject},
          ${record.role},
          ${record.createdAt},
          ${record.expiresAt},
          ${record.lastConnectedAt}
        )
      `,
  });

  const findSessionByTokenHashQuery = SqlSchema.findAll({
    Request: FindAuthSessionByTokenHashInput,
    Result: AuthSessionDbRowSchema,
    execute: ({ tokenHash, now }) =>
      sql`
        SELECT
          session_id AS "sessionId",
          token_hash AS "tokenHash",
          subject,
          role,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          last_connected_at AS "lastConnectedAt"
        FROM auth_sessions
        WHERE token_hash = ${tokenHash}
          AND expires_at > ${now}
        LIMIT 1
      `,
  });

  const touchSessionQuery = SqlSchema.void({
    Request: TouchAuthSessionInput,
    execute: ({ sessionId, lastConnectedAt }) =>
      sql`
        UPDATE auth_sessions
        SET last_connected_at = ${lastConnectedAt}
        WHERE session_id = ${sessionId}
      `,
  });

  const insertPairingCredentialQuery = SqlSchema.void({
    Request: AuthPairingCredentialRecord,
    execute: (record) =>
      sql`
        INSERT INTO auth_pairing_credentials (
          id,
          token_hash,
          subject,
          role,
          created_at,
          expires_at,
          used_at
        )
        VALUES (
          ${record.id},
          ${record.tokenHash},
          ${record.subject},
          ${record.role},
          ${record.createdAt},
          ${record.expiresAt},
          ${record.usedAt}
        )
      `,
  });

  const findPairingCredentialByTokenHashQuery = SqlSchema.findAll({
    Request: FindPairingCredentialByTokenHashInput,
    Result: AuthPairingCredentialDbRowSchema,
    execute: ({ tokenHash, now }) =>
      sql`
        SELECT
          id,
          token_hash AS "tokenHash",
          subject,
          role,
          created_at AS "createdAt",
          expires_at AS "expiresAt",
          used_at AS "usedAt"
        FROM auth_pairing_credentials
        WHERE token_hash = ${tokenHash}
          AND used_at IS NULL
          AND expires_at > ${now}
        LIMIT 1
      `,
  });

  const markPairingCredentialUsedQuery = SqlSchema.void({
    Request: MarkPairingCredentialUsedInput,
    execute: ({ id, usedAt }) =>
      sql`
        UPDATE auth_pairing_credentials
        SET used_at = ${usedAt}
        WHERE id = ${id}
      `,
  });

  const insertSession: AuthSessionRepositoryShape["insertSession"] = (record) =>
    insertSessionQuery(record).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AuthSessionRepository.insertSession:query",
          "AuthSessionRepository.insertSession:encodeRequest",
        ),
      ),
    );

  const findSessionByTokenHash: AuthSessionRepositoryShape["findSessionByTokenHash"] = (input) =>
    findSessionByTokenHashQuery(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AuthSessionRepository.findSessionByTokenHash:query",
          "AuthSessionRepository.findSessionByTokenHash:decodeRows",
        ),
      ),
      Effect.flatMap((rows) =>
        rows.length === 0
          ? Effect.succeed(null)
          : Schema.decodeUnknownEffect(AuthSessionRecord)(rows[0]).pipe(
              Effect.mapError(
                toPersistenceDecodeError("AuthSessionRepository.findSessionByTokenHash:decodeRow"),
              ),
            ),
      ),
    );

  const touchSession: AuthSessionRepositoryShape["touchSession"] = (input) =>
    touchSessionQuery(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AuthSessionRepository.touchSession:query",
          "AuthSessionRepository.touchSession:encodeRequest",
        ),
      ),
    );

  const insertPairingCredential: AuthSessionRepositoryShape["insertPairingCredential"] = (record) =>
    insertPairingCredentialQuery(record).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AuthSessionRepository.insertPairingCredential:query",
          "AuthSessionRepository.insertPairingCredential:encodeRequest",
        ),
      ),
    );

  const findPairingCredentialByTokenHash: AuthSessionRepositoryShape["findPairingCredentialByTokenHash"] =
    (input) =>
      findPairingCredentialByTokenHashQuery(input).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "AuthSessionRepository.findPairingCredentialByTokenHash:query",
            "AuthSessionRepository.findPairingCredentialByTokenHash:decodeRows",
          ),
        ),
        Effect.flatMap((rows) =>
          rows.length === 0
            ? Effect.succeed(null)
            : Schema.decodeUnknownEffect(AuthPairingCredentialRecord)(rows[0]).pipe(
                Effect.mapError(
                  toPersistenceDecodeError(
                    "AuthSessionRepository.findPairingCredentialByTokenHash:decodeRow",
                  ),
                ),
              ),
        ),
      );

  const markPairingCredentialUsed: AuthSessionRepositoryShape["markPairingCredentialUsed"] = (
    input,
  ) =>
    markPairingCredentialUsedQuery(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "AuthSessionRepository.markPairingCredentialUsed:query",
          "AuthSessionRepository.markPairingCredentialUsed:encodeRequest",
        ),
      ),
    );

  return {
    insertSession,
    findSessionByTokenHash,
    touchSession,
    insertPairingCredential,
    findPairingCredentialByTokenHash,
    markPairingCredentialUsed,
  } satisfies AuthSessionRepositoryShape;
});

export const AuthSessionRepositoryLive = Layer.effect(
  AuthSessionRepository,
  makeAuthSessionRepository,
);
