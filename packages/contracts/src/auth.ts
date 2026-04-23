import { Schema } from "effect";

import { IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas";

export const AuthSessionRole = Schema.Literals(["owner", "client"]);
export type AuthSessionRole = typeof AuthSessionRole.Type;

export const AuthBootstrapInput = Schema.Struct({
  credential: TrimmedNonEmptyString,
});
export type AuthBootstrapInput = typeof AuthBootstrapInput.Type;

export const AuthBootstrapResult = Schema.Struct({
  role: AuthSessionRole,
  subject: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
});
export type AuthBootstrapResult = typeof AuthBootstrapResult.Type;

export const AuthCreatePairingCredentialInput = Schema.Struct({
  label: Schema.optional(TrimmedNonEmptyString),
});
export type AuthCreatePairingCredentialInput = typeof AuthCreatePairingCredentialInput.Type;

export const AuthPairingCredentialResult = Schema.Struct({
  credential: TrimmedNonEmptyString,
  role: AuthSessionRole,
  subject: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
});
export type AuthPairingCredentialResult = typeof AuthPairingCredentialResult.Type;

export const AuthSessionState = Schema.Struct({
  authenticated: Schema.Boolean,
  auth: Schema.Struct({
    enabled: Schema.Boolean,
  }),
  role: Schema.optional(AuthSessionRole),
  subject: Schema.optional(TrimmedNonEmptyString),
  expiresAt: Schema.optional(IsoDateTime),
});
export type AuthSessionState = typeof AuthSessionState.Type;
