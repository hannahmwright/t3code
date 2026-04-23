import type {
  AuthBootstrapInput,
  AuthBootstrapResult,
  AuthCreatePairingCredentialInput,
  AuthPairingCredentialResult,
  AuthSessionState,
} from "@t3tools/contracts";

import { resolvePrimaryEnvironmentHttpUrl } from "./primaryEnvironment";
import { readDesktopUrlBootstrap } from "./desktopUrlBootstrap";

const PAIRING_TOKEN_QUERY_PARAM = "pairingToken";

function readConfiguredBootstrapCredential(): string | null {
  const configuredWsUrl = import.meta.env.VITE_WS_URL?.trim();
  if (!configuredWsUrl) {
    return null;
  }

  try {
    const url = new URL(configuredWsUrl);
    return url.searchParams.get("token");
  } catch {
    return null;
  }
}

function readDesktopBootstrapCredential(): string | null {
  const bootstrap = window.desktopBridge?.getLocalEnvironmentBootstrap?.();
  return typeof bootstrap?.bootstrapToken === "string" && bootstrap.bootstrapToken.length > 0
    ? bootstrap.bootstrapToken
    : null;
}

function readDesktopUrlBootstrapCredential(): string | null {
  const bootstrap = readDesktopUrlBootstrap();
  if (!bootstrap?.wsBaseUrl) {
    return null;
  }

  try {
    return new URL(bootstrap.wsBaseUrl).searchParams.get("token");
  } catch {
    return null;
  }
}

export function readEnvironmentBootstrapCredential(): string | null {
  return (
    readConfiguredBootstrapCredential() ??
    readDesktopBootstrapCredential() ??
    readDesktopUrlBootstrapCredential()
  );
}

export function peekPairingCredentialFromUrl(): string | null {
  return new URL(window.location.href).searchParams.get(PAIRING_TOKEN_QUERY_PARAM);
}

export function stripPairingCredentialFromUrl(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(PAIRING_TOKEN_QUERY_PARAM)) {
    return;
  }
  url.searchParams.delete(PAIRING_TOKEN_QUERY_PARAM);
  window.history.replaceState({}, document.title, url.toString());
}

export async function fetchServerAuthSessionState(): Promise<AuthSessionState> {
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/session"), {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error(`Failed to read server auth state (${response.status}).`);
  }
  return (await response.json()) as AuthSessionState;
}

export async function submitServerAuthCredential(credential: string): Promise<AuthBootstrapResult> {
  const trimmedCredential = credential.trim();
  if (trimmedCredential.length === 0) {
    throw new Error("Enter a pairing credential to continue.");
  }

  const payload: AuthBootstrapInput = { credential: trimmedCredential };
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/bootstrap"), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to authenticate (${response.status}).`);
  }

  return (await response.json()) as AuthBootstrapResult;
}

export async function createServerPairingCredential(
  label?: string,
): Promise<AuthPairingCredentialResult> {
  const payload: AuthCreatePairingCredentialInput =
    label && label.trim().length > 0 ? { label: label.trim() } : {};
  const response = await fetch(resolvePrimaryEnvironmentHttpUrl("/api/auth/pairing-token"), {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Failed to create pairing link (${response.status}).`);
  }
  return (await response.json()) as AuthPairingCredentialResult;
}

export function buildPairingUrl(credential: string): string {
  const url = new URL(resolvePrimaryEnvironmentHttpUrl("/"));
  url.searchParams.set(PAIRING_TOKEN_QUERY_PARAM, credential);
  return url.toString();
}
