import { IsoDateTime } from "@t3tools/contracts";
import { Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const AuthSessionRecord = Schema.Struct({
  sessionId: Schema.String,
  tokenHash: Schema.String,
  subject: Schema.String,
  role: Schema.Literals(["owner", "client"]),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  lastConnectedAt: Schema.NullOr(IsoDateTime),
});
export type AuthSessionRecord = typeof AuthSessionRecord.Type;

export const AuthPairingCredentialRecord = Schema.Struct({
  id: Schema.String,
  tokenHash: Schema.String,
  subject: Schema.String,
  role: Schema.Literals(["owner", "client"]),
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  usedAt: Schema.NullOr(IsoDateTime),
});
export type AuthPairingCredentialRecord = typeof AuthPairingCredentialRecord.Type;

export const FindAuthSessionByTokenHashInput = Schema.Struct({
  tokenHash: Schema.String,
  now: IsoDateTime,
});
export type FindAuthSessionByTokenHashInput = typeof FindAuthSessionByTokenHashInput.Type;

export const TouchAuthSessionInput = Schema.Struct({
  sessionId: Schema.String,
  lastConnectedAt: IsoDateTime,
});
export type TouchAuthSessionInput = typeof TouchAuthSessionInput.Type;

export const FindPairingCredentialByTokenHashInput = Schema.Struct({
  tokenHash: Schema.String,
  now: IsoDateTime,
});
export type FindPairingCredentialByTokenHashInput =
  typeof FindPairingCredentialByTokenHashInput.Type;

export const MarkPairingCredentialUsedInput = Schema.Struct({
  id: Schema.String,
  usedAt: IsoDateTime,
});
export type MarkPairingCredentialUsedInput = typeof MarkPairingCredentialUsedInput.Type;

export interface AuthSessionRepositoryShape {
  readonly insertSession: (
    record: AuthSessionRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly findSessionByTokenHash: (
    input: FindAuthSessionByTokenHashInput,
  ) => Effect.Effect<AuthSessionRecord | null, ProjectionRepositoryError>;
  readonly touchSession: (
    input: TouchAuthSessionInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly insertPairingCredential: (
    record: AuthPairingCredentialRecord,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly findPairingCredentialByTokenHash: (
    input: FindPairingCredentialByTokenHashInput,
  ) => Effect.Effect<AuthPairingCredentialRecord | null, ProjectionRepositoryError>;
  readonly markPairingCredentialUsed: (
    input: MarkPairingCredentialUsedInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class AuthSessionRepository extends ServiceMap.Service<
  AuthSessionRepository,
  AuthSessionRepositoryShape
>()("t3/persistence/Services/AuthSessions/AuthSessionRepository") {}
