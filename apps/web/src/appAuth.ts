import { useEffect, useSyncExternalStore } from "react";

import { clearBootstrapCache, readBootstrapCache } from "./bootstrapCache";
import { isElectron } from "./env";

export interface AppAuthStatus {
  readonly ready: boolean;
  readonly reachable: boolean;
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly username: string | null;
  readonly sessionTtlDays: number | null;
  readonly error: string | null;
}

interface AppAuthSessionResponse {
  readonly enabled: boolean;
  readonly authenticated: boolean;
  readonly username: string | null;
  readonly sessionTtlDays: number | null;
}

const DEFAULT_APP_AUTH_STATUS: AppAuthStatus = {
  ready: false,
  reachable: false,
  enabled: false,
  authenticated: false,
  username: null,
  sessionTtlDays: null,
  error: null,
};

export const DESKTOP_APP_AUTH_RETRY_DELAY_MS = 1_000;
const WARM_BOOT_APP_AUTH_STATUS: AppAuthStatus = {
  ready: true,
  reachable: true,
  enabled: false,
  authenticated: true,
  username: null,
  sessionTtlDays: null,
  error: null,
};
const DESKTOP_LOCAL_AUTH_STATUS: AppAuthStatus = {
  ready: true,
  reachable: true,
  enabled: false,
  authenticated: true,
  username: "local",
  sessionTtlDays: null,
  error: null,
};

export function shouldBypassAppAuthForDesktopShell(
  desktopApp = isElectron,
  locationProtocol = typeof window !== "undefined" ? window.location.protocol : "",
): boolean {
  return desktopApp && locationProtocol === "t3:";
}

export function shouldWaitForDesktopAuthService(
  status: Pick<AppAuthStatus, "ready" | "reachable">,
  desktopApp = isElectron,
): boolean {
  return desktopApp && status.ready && !status.reachable;
}

function readRuntimeAppAuthEnabledFlag(): boolean | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return typeof window.__T3_APP_AUTH_ENABLED === "boolean"
    ? window.__T3_APP_AUTH_ENABLED
    : undefined;
}

export function shouldWarmStartAppAuthStatus(input: {
  readonly bypassAppAuth: boolean;
  readonly hasBootstrapCache: boolean;
  readonly runtimeAppAuthEnabled: boolean | undefined;
}): boolean {
  return !input.bypassAppAuth && input.runtimeAppAuthEnabled === false && input.hasBootstrapCache;
}

function getInitialAppAuthStatus(): {
  readonly needsRefresh: boolean;
  readonly status: AppAuthStatus;
} {
  const bypassAppAuth = shouldBypassAppAuthForDesktopShell();
  const hasBootstrapCache = readBootstrapCache() !== null;
  const runtimeAppAuthEnabled = readRuntimeAppAuthEnabledFlag();
  if (
    shouldWarmStartAppAuthStatus({
      bypassAppAuth,
      hasBootstrapCache,
      runtimeAppAuthEnabled,
    })
  ) {
    return {
      status: WARM_BOOT_APP_AUTH_STATUS,
      needsRefresh: true,
    };
  }

  return {
    status: DEFAULT_APP_AUTH_STATUS,
    needsRefresh: false,
  };
}

const initialAppAuthStatus = getInitialAppAuthStatus();
let appAuthStatus = initialAppAuthStatus.status;
let pendingWarmStartRefresh = initialAppAuthStatus.needsRefresh;
const listeners = new Set<() => void>();

function emit(next: AppAuthStatus) {
  appAuthStatus = next;
  for (const listener of listeners) {
    listener();
  }
}

function toAppAuthStatus(response: AppAuthSessionResponse): AppAuthStatus {
  return {
    ready: true,
    reachable: true,
    enabled: response.enabled,
    authenticated: response.authenticated,
    username: response.username,
    sessionTtlDays: response.sessionTtlDays,
    error: null,
  };
}

export async function refreshAppAuthStatus(): Promise<AppAuthStatus> {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`Unable to load auth state (${response.status}).`);
    }
    const payload = (await response.json()) as AppAuthSessionResponse;
    const next = toAppAuthStatus(payload);
    emit(next);
    return next;
  } catch (error) {
    const next: AppAuthStatus = {
      ...appAuthStatus,
      ready: true,
      reachable: false,
      error: error instanceof Error ? error.message : "Unable to reach the auth service.",
    };
    emit(next);
    return next;
  }
}

export async function signInWithPassword(input: {
  readonly username: string;
  readonly password: string;
  readonly remember: boolean;
}): Promise<AppAuthStatus> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const payload = (await response.json().catch(() => null)) as
    | (AppAuthSessionResponse & { readonly ok?: boolean; readonly message?: string })
    | null;

  if (!response.ok || !payload?.authenticated) {
    const message = payload?.message ?? "Unable to sign in.";
    const next: AppAuthStatus = {
      ...appAuthStatus,
      ready: true,
      error: message,
      authenticated: false,
    };
    emit(next);
    throw new Error(message);
  }

  const next = toAppAuthStatus(payload);
  emit(next);
  return next;
}

export async function signOutOfApp(): Promise<AppAuthStatus> {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
  }).catch(() => undefined);
  clearBootstrapCache();
  const next: AppAuthStatus = {
    ready: true,
    reachable: true,
    enabled: appAuthStatus.enabled,
    authenticated: false,
    username: null,
    sessionTtlDays: appAuthStatus.sessionTtlDays,
    error: null,
  };
  emit(next);
  return next;
}

export function getAppAuthStatus(): AppAuthStatus {
  return appAuthStatus;
}

export function subscribeToAppAuthStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAppAuthStatus(): AppAuthStatus {
  const bypassAppAuth = shouldBypassAppAuthForDesktopShell();
  const status = useSyncExternalStore(subscribeToAppAuthStatus, getAppAuthStatus, getAppAuthStatus);

  useEffect(() => {
    if (bypassAppAuth) {
      return;
    }

    if (pendingWarmStartRefresh) {
      pendingWarmStartRefresh = false;
      void refreshAppAuthStatus();
      return;
    }

    if (!status.ready) {
      void refreshAppAuthStatus();
      return;
    }

    if (shouldWaitForDesktopAuthService(status)) {
      const retryHandle = window.setTimeout(() => {
        void refreshAppAuthStatus();
      }, DESKTOP_APP_AUTH_RETRY_DELAY_MS);
      return () => {
        window.clearTimeout(retryHandle);
      };
    }
  }, [bypassAppAuth, status.ready, status.reachable]);

  return bypassAppAuth ? DESKTOP_LOCAL_AUTH_STATUS : status;
}
