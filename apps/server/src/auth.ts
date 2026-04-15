import { createHmac, timingSafeEqual } from "node:crypto";

import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import type { ServerConfigShape } from "./config";

export const APP_SESSION_COOKIE_NAME = "t3_session";

export interface AppAuthSession {
  readonly username: string;
  readonly expiresAt: number;
  readonly issuedAt: number;
}

interface EncodedSessionPayload {
  readonly u: string;
  readonly exp: number;
  readonly iat: number;
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function createSignature(value: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(value).digest();
}

function getAppAuthSecret(config: ServerConfigShape): string | null {
  if (!config.appAuthEnabled || !config.appAuthPassword) {
    return null;
  }

  return config.appAuthSessionSecret ?? config.authToken ?? config.appAuthPassword;
}

export function isAppAuthEnabled(config: ServerConfigShape): boolean {
  return config.appAuthEnabled;
}

export function verifyAppAuthCredentials(
  config: ServerConfigShape,
  username: string,
  password: string,
): boolean {
  if (!config.appAuthEnabled || !config.appAuthUsername || !config.appAuthPassword) {
    return false;
  }

  const providedUsername = Buffer.from(username, "utf8");
  const expectedUsername = Buffer.from(config.appAuthUsername, "utf8");
  const providedPassword = Buffer.from(password, "utf8");
  const expectedPassword = Buffer.from(config.appAuthPassword, "utf8");
  const usernameMatches =
    providedUsername.length === expectedUsername.length &&
    timingSafeEqual(providedUsername, expectedUsername);
  const passwordMatches =
    providedPassword.length === expectedPassword.length &&
    timingSafeEqual(providedPassword, expectedPassword);

  return usernameMatches && passwordMatches;
}

export function createAppAuthSessionToken(
  config: ServerConfigShape,
  username: string,
  now = Date.now(),
): string | null {
  const secret = getAppAuthSecret(config);
  if (!secret) {
    return null;
  }

  const payload: EncodedSessionPayload = {
    u: username,
    iat: now,
    exp: now + config.appAuthSessionTtlDays * 24 * 60 * 60 * 1000,
  };
  const payloadEncoded = encodeBase64Url(JSON.stringify(payload));
  const signatureEncoded = createSignature(payloadEncoded, secret)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");

  return `${payloadEncoded}.${signatureEncoded}`;
}

export function readAppAuthSession(
  request: HttpServerRequest.HttpServerRequest,
  config: ServerConfigShape,
  now = Date.now(),
): AppAuthSession | null {
  if (!config.appAuthEnabled) {
    return {
      username: config.appAuthUsername ?? "local",
      expiresAt: Number.MAX_SAFE_INTEGER,
      issuedAt: now,
    };
  }

  const secret = getAppAuthSecret(config);
  const cookieValue = request.cookies[APP_SESSION_COOKIE_NAME];
  if (!secret || !cookieValue) {
    return null;
  }

  const [payloadEncoded, signatureEncoded] = cookieValue.split(".");
  if (!payloadEncoded || !signatureEncoded) {
    return null;
  }

  const expectedSignature = createSignature(payloadEncoded, secret);
  const providedSignature = Buffer.from(
    signatureEncoded.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  if (
    providedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(providedSignature, expectedSignature)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(payloadEncoded)) as EncodedSessionPayload;
    if (payload.u !== config.appAuthUsername || payload.exp <= now) {
      return null;
    }

    return {
      username: payload.u,
      issuedAt: payload.iat,
      expiresAt: payload.exp,
    };
  } catch {
    return null;
  }
}

export function shouldUseSecureCookie(request: HttpServerRequest.HttpServerRequest): boolean {
  const forwardedProto = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
  if (forwardedProto) {
    return forwardedProto === "https";
  }

  const url = HttpServerRequest.toURL(request);
  return url._tag === "Some" ? url.value.protocol === "https:" : false;
}

export function withAppAuthCookie(
  response: HttpServerResponse.HttpServerResponse,
  request: HttpServerRequest.HttpServerRequest,
  value: string,
  remember: boolean,
  config: ServerConfigShape,
): HttpServerResponse.HttpServerResponse {
  const rememberExpiresAt = new Date(
    Date.now() + config.appAuthSessionTtlDays * 24 * 60 * 60 * 1000,
  );
  return HttpServerResponse.setCookieUnsafe(response, APP_SESSION_COOKIE_NAME, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(request),
    ...(remember ? { expires: rememberExpiresAt } : {}),
  });
}

export function clearAppAuthCookie(
  response: HttpServerResponse.HttpServerResponse,
  request: HttpServerRequest.HttpServerRequest,
): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.expireCookieUnsafe(response, APP_SESSION_COOKIE_NAME, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: shouldUseSecureCookie(request),
  });
}

export function isSameOriginRequest(request: HttpServerRequest.HttpServerRequest): boolean {
  const origin = request.headers.origin;
  const forwardedHost = request.headers["x-forwarded-host"]?.split(",")[0]?.trim();
  const forwardedProto = request.headers["x-forwarded-proto"]?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.host;
  if (!origin || !host) {
    return true;
  }

  try {
    const parsedOrigin = new URL(origin);
    const requestUrl = HttpServerRequest.toURL(request);
    const expectedProtocol = forwardedProto
      ? `${forwardedProto}:`
      : requestUrl._tag === "Some"
        ? requestUrl.value.protocol
        : null;
    if (expectedProtocol && parsedOrigin.protocol !== expectedProtocol) {
      return false;
    }
    return parsedOrigin.host === host;
  } catch {
    return false;
  }
}
