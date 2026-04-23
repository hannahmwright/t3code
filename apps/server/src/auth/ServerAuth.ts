import crypto from "node:crypto";
import type http from "node:http";

import type {
  AuthBootstrapResult,
  AuthPairingCredentialResult,
  AuthSessionRole,
  AuthSessionState,
} from "@t3tools/contracts";
import { Effect, Schema, ServiceMap } from "effect";

import { ServerConfig } from "../config.ts";
import { AuthSessionRepository } from "../persistence/Services/AuthSessions.ts";

const SESSION_COOKIE_NAME = "t3code_session";
const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1_000;
const PAIRING_CREDENTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export class ServerAuthError extends Schema.TaggedErrorClass<ServerAuthError>()("ServerAuthError", {
  message: Schema.String,
  status: Schema.Number,
}) {}

interface AuthenticatedServerSession {
  readonly sessionId: string;
  readonly subject: string;
  readonly role: AuthSessionRole;
  readonly expiresAt: string;
}

export interface ServerAuthShape {
  readonly sessionCookieName: string;
  readonly getSessionState: (
    headers: http.IncomingHttpHeaders,
  ) => Effect.Effect<AuthSessionState, never>;
  readonly authenticateHeaders: (
    headers: http.IncomingHttpHeaders,
  ) => Effect.Effect<AuthenticatedServerSession | null, never>;
  readonly requireOwnerSession: (
    headers: http.IncomingHttpHeaders,
  ) => Effect.Effect<AuthenticatedServerSession, ServerAuthError>;
  readonly bootstrapWithCredential: (credential: string) => Effect.Effect<
    {
      readonly sessionToken: string;
      readonly response: AuthBootstrapResult;
    },
    ServerAuthError
  >;
  readonly issuePairingCredential: (
    label: string | null,
  ) => Effect.Effect<AuthPairingCredentialResult, ServerAuthError>;
  readonly validateWebSocketRequest: (req: http.IncomingMessage) => Effect.Effect<boolean, never>;
}

export class ServerAuth extends ServiceMap.Service<ServerAuth, ServerAuthShape>()(
  "t3/auth/ServerAuth",
) {}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function issueOpaqueToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function parseCookies(cookieHeader: string | undefined): ReadonlyMap<string, string> {
  if (!cookieHeader) {
    return new Map();
  }

  const cookies = new Map<string, string>();
  for (const part of cookieHeader.split(";")) {
    const trimmedPart = part.trim();
    if (trimmedPart.length === 0) {
      continue;
    }

    const separatorIndex = trimmedPart.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmedPart.slice(0, separatorIndex).trim();
    const value = trimmedPart.slice(separatorIndex + 1).trim();
    if (!key || !value) {
      continue;
    }
    cookies.set(key, decodeURIComponent(value));
  }

  return cookies;
}

function readSessionCookie(headers: http.IncomingHttpHeaders): string | null {
  return parseCookies(headers.cookie).get(SESSION_COOKIE_NAME) ?? null;
}

function toIsoDateTime(value: number): string {
  return new Date(value).toISOString();
}

function toAuthenticatedSession(record: {
  sessionId: string;
  subject: string;
  role: AuthSessionRole;
  expiresAt: string;
}): AuthenticatedServerSession {
  return {
    sessionId: record.sessionId,
    subject: record.subject,
    role: record.role,
    expiresAt: record.expiresAt,
  };
}

function readQueryToken(rawUrl: string | undefined): string | null {
  try {
    return new URL(rawUrl ?? "/", "http://localhost").searchParams.get("token");
  } catch {
    return null;
  }
}

export const ServerAuthLive = Effect.gen(function* () {
  const { authToken } = yield* ServerConfig;
  const authSessionRepository = yield* AuthSessionRepository;

  const authenticateHeaders: ServerAuthShape["authenticateHeaders"] = (headers) =>
    Effect.gen(function* () {
      if (!authToken) {
        return {
          sessionId: "local-owner",
          subject: "Local owner",
          role: "owner",
          expiresAt: toIsoDateTime(Date.now() + SESSION_TTL_MS),
        } satisfies AuthenticatedServerSession;
      }

      const sessionToken = readSessionCookie(headers);
      if (!sessionToken) {
        return null;
      }

      const now = new Date().toISOString();
      const sessionRecord = yield* authSessionRepository
        .findSessionByTokenHash({
          tokenHash: hashToken(sessionToken),
          now,
        })
        .pipe(Effect.orElseSucceed(() => null));
      if (!sessionRecord) {
        return null;
      }

      yield* authSessionRepository
        .touchSession({
          sessionId: sessionRecord.sessionId,
          lastConnectedAt: now,
        })
        .pipe(Effect.ignore);

      return toAuthenticatedSession(sessionRecord);
    });

  const getSessionState: ServerAuthShape["getSessionState"] = (headers) =>
    Effect.gen(function* () {
      if (!authToken) {
        return {
          authenticated: true,
          auth: { enabled: false },
          role: "owner",
          subject: "Local owner",
          expiresAt: toIsoDateTime(Date.now() + SESSION_TTL_MS),
        } satisfies AuthSessionState;
      }

      const session = yield* authenticateHeaders(headers);
      if (!session) {
        return {
          authenticated: false,
          auth: { enabled: true },
        } satisfies AuthSessionState;
      }

      return {
        authenticated: true,
        auth: { enabled: true },
        role: session.role,
        subject: session.subject,
        expiresAt: session.expiresAt,
      } satisfies AuthSessionState;
    });

  const requireOwnerSession: ServerAuthShape["requireOwnerSession"] = (headers) =>
    Effect.gen(function* () {
      const session = yield* authenticateHeaders(headers);
      if (!session) {
        return yield* new ServerAuthError({
          message: "Authentication required.",
          status: 401,
        });
      }
      if (session.role !== "owner") {
        return yield* new ServerAuthError({
          message: "Only owner sessions can manage pairing links.",
          status: 403,
        });
      }
      return session;
    });

  const bootstrapWithCredential: ServerAuthShape["bootstrapWithCredential"] = (credential) =>
    Effect.gen(function* () {
      const trimmedCredential = credential.trim();
      if (!authToken) {
        return yield* new ServerAuthError({
          message: "Server auth is not enabled.",
          status: 400,
        });
      }
      if (trimmedCredential.length === 0) {
        return yield* new ServerAuthError({
          message: "A pairing credential is required.",
          status: 400,
        });
      }

      let subject = "Paired device";
      let role: AuthSessionRole = "client";
      if (trimmedCredential === authToken) {
        subject = "Owner session";
        role = "owner";
      } else {
        const now = new Date().toISOString();
        const pairingCredential = yield* authSessionRepository
          .findPairingCredentialByTokenHash({
            tokenHash: hashToken(trimmedCredential),
            now,
          })
          .pipe(Effect.orElseSucceed(() => null));
        if (!pairingCredential) {
          return yield* new ServerAuthError({
            message: "That pairing credential is invalid or has expired.",
            status: 401,
          });
        }

        subject = pairingCredential.subject;
        role = pairingCredential.role;
        yield* authSessionRepository
          .markPairingCredentialUsed({
            id: pairingCredential.id,
            usedAt: now,
          })
          .pipe(Effect.ignore);
      }

      const sessionToken = issueOpaqueToken();
      const createdAt = Date.now();
      const expiresAt = createdAt + SESSION_TTL_MS;
      yield* authSessionRepository
        .insertSession({
          sessionId: crypto.randomUUID(),
          tokenHash: hashToken(sessionToken),
          subject,
          role,
          createdAt: toIsoDateTime(createdAt),
          expiresAt: toIsoDateTime(expiresAt),
          lastConnectedAt: null,
        })
        .pipe(
          Effect.mapError(
            () =>
              new ServerAuthError({
                message: "Failed to create an authenticated session.",
                status: 500,
              }),
          ),
        );

      return {
        sessionToken,
        response: {
          role,
          subject,
          expiresAt: toIsoDateTime(expiresAt),
        },
      };
    });

  const issuePairingCredential: ServerAuthShape["issuePairingCredential"] = (label) =>
    Effect.gen(function* () {
      if (!authToken) {
        return yield* new ServerAuthError({
          message: "Server auth is not enabled.",
          status: 400,
        });
      }

      const credential = issueOpaqueToken();
      const createdAt = Date.now();
      const expiresAt = createdAt + PAIRING_CREDENTIAL_TTL_MS;
      const subject = label?.trim() || "Paired device";

      yield* authSessionRepository
        .insertPairingCredential({
          id: crypto.randomUUID(),
          tokenHash: hashToken(credential),
          subject,
          role: "client",
          createdAt: toIsoDateTime(createdAt),
          expiresAt: toIsoDateTime(expiresAt),
          usedAt: null,
        })
        .pipe(
          Effect.mapError(
            () =>
              new ServerAuthError({
                message: "Failed to create a pairing credential.",
                status: 500,
              }),
          ),
        );

      return {
        credential,
        role: "client",
        subject,
        createdAt: toIsoDateTime(createdAt),
        expiresAt: toIsoDateTime(expiresAt),
      } satisfies AuthPairingCredentialResult;
    });

  const validateWebSocketRequest: ServerAuthShape["validateWebSocketRequest"] = (req) =>
    Effect.gen(function* () {
      if (!authToken) {
        return true;
      }

      if (readQueryToken(req.url) === authToken) {
        return true;
      }

      const session = yield* authenticateHeaders(req.headers);
      return session !== null;
    });

  return {
    sessionCookieName: SESSION_COOKIE_NAME,
    getSessionState,
    authenticateHeaders,
    requireOwnerSession,
    bootstrapWithCredential,
    issuePairingCredential,
    validateWebSocketRequest,
  } satisfies ServerAuthShape;
});
