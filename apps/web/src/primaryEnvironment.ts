import type { DesktopEnvironmentBootstrap } from "@t3tools/contracts";
import { DEFAULT_LOCAL_SERVER_PORT } from "@t3tools/shared/serverDefaults";

import { readDesktopUrlBootstrap } from "./desktopUrlBootstrap";

export type PrimaryEnvironmentSource =
  | "configured"
  | "desktop-managed"
  | "desktop-url"
  | "desktop-loopback"
  | "window-origin";

export interface PrimaryEnvironmentTarget {
  readonly source: PrimaryEnvironmentSource;
  readonly httpBaseUrl: string;
  readonly wsBaseUrl: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getWindowLocationHost(): string {
  if (typeof window === "undefined") {
    return "localhost";
  }

  if (isNonEmptyString(window.location.host)) {
    return window.location.host;
  }

  const hostname = window.location.hostname;
  const port = window.location.port;
  return [hostname, port]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join(":");
}

function getWindowHttpBaseUrl(): string {
  if (typeof window === "undefined") {
    return "http://localhost";
  }

  if (isNonEmptyString(window.location.origin) && window.location.origin !== "null") {
    return window.location.origin;
  }

  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${getWindowLocationHost()}`;
}

function toWsBaseUrl(rawHttpBaseUrl: string): string | null {
  try {
    const url = new URL(rawHttpBaseUrl);
    if (url.protocol === "http:") {
      url.protocol = "ws:";
    } else if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function toHttpBaseUrl(rawWsBaseUrl: string): string | null {
  try {
    const url = new URL(rawWsBaseUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    } else if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function asConfiguredTarget(): PrimaryEnvironmentTarget | null {
  const configuredWsBaseUrl = import.meta.env.VITE_WS_URL?.trim();
  const configuredHttpBaseUrl = import.meta.env.VITE_HTTP_URL?.trim();

  if (!configuredWsBaseUrl && !configuredHttpBaseUrl) {
    return null;
  }

  const wsBaseUrl =
    (configuredWsBaseUrl && isNonEmptyString(configuredWsBaseUrl) && configuredWsBaseUrl) ||
    (configuredHttpBaseUrl && isNonEmptyString(configuredHttpBaseUrl)
      ? toWsBaseUrl(configuredHttpBaseUrl)
      : null);
  const httpBaseUrl =
    (configuredHttpBaseUrl && isNonEmptyString(configuredHttpBaseUrl) && configuredHttpBaseUrl) ||
    (configuredWsBaseUrl && isNonEmptyString(configuredWsBaseUrl)
      ? toHttpBaseUrl(configuredWsBaseUrl)
      : null);

  if (!wsBaseUrl || !httpBaseUrl) {
    return null;
  }

  return {
    source: "configured",
    httpBaseUrl,
    wsBaseUrl,
  };
}

function asTargetFromBootstrap(
  source: Extract<PrimaryEnvironmentSource, "desktop-managed" | "desktop-url">,
  bootstrap: DesktopEnvironmentBootstrap | null | undefined,
): PrimaryEnvironmentTarget | null {
  if (!bootstrap) {
    return null;
  }

  const wsBaseUrl =
    (isNonEmptyString(bootstrap.wsBaseUrl) && bootstrap.wsBaseUrl) ||
    (isNonEmptyString(bootstrap.httpBaseUrl) ? toWsBaseUrl(bootstrap.httpBaseUrl) : null);
  const httpBaseUrl =
    (isNonEmptyString(bootstrap.httpBaseUrl) && bootstrap.httpBaseUrl) ||
    (isNonEmptyString(bootstrap.wsBaseUrl) ? toHttpBaseUrl(bootstrap.wsBaseUrl) : null);

  if (!wsBaseUrl || !httpBaseUrl) {
    return null;
  }

  return {
    source,
    httpBaseUrl,
    wsBaseUrl,
  };
}

function asDesktopManagedTarget(): PrimaryEnvironmentTarget | null {
  if (typeof window === "undefined") {
    return null;
  }

  const bootstrap = window.desktopBridge?.getLocalEnvironmentBootstrap?.();
  const fromBootstrap = asTargetFromBootstrap("desktop-managed", bootstrap);
  if (fromBootstrap) {
    return fromBootstrap;
  }

  const legacyWsBaseUrl = window.desktopBridge?.getWsUrl?.();
  if (!isNonEmptyString(legacyWsBaseUrl)) {
    return null;
  }

  return asTargetFromBootstrap("desktop-managed", {
    label: "Local desktop",
    httpBaseUrl: null,
    wsBaseUrl: legacyWsBaseUrl,
  });
}

function asDesktopUrlTarget(): PrimaryEnvironmentTarget | null {
  return asTargetFromBootstrap("desktop-url", readDesktopUrlBootstrap());
}

function asDesktopLoopbackTarget(): PrimaryEnvironmentTarget | null {
  if (typeof window === "undefined" || window.location.protocol !== "t3:") {
    return null;
  }

  const httpBaseUrl = `http://127.0.0.1:${DEFAULT_LOCAL_SERVER_PORT}`;
  const wsBaseUrl = `ws://127.0.0.1:${DEFAULT_LOCAL_SERVER_PORT}/`;
  return {
    source: "desktop-loopback",
    httpBaseUrl,
    wsBaseUrl,
  };
}

function asWindowOriginTarget(): PrimaryEnvironmentTarget {
  const httpBaseUrl = getWindowHttpBaseUrl();
  const wsBaseUrl = toWsBaseUrl(httpBaseUrl) ?? `ws://${getWindowLocationHost()}`;
  return {
    source: "window-origin",
    httpBaseUrl,
    wsBaseUrl,
  };
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

export function resolvePrimaryEnvironmentTarget(): PrimaryEnvironmentTarget {
  return (
    asConfiguredTarget() ??
    asDesktopManagedTarget() ??
    asDesktopUrlTarget() ??
    asDesktopLoopbackTarget() ??
    asWindowOriginTarget()
  );
}

export function resolvePrimaryEnvironmentWsUrl(): string {
  return resolvePrimaryEnvironmentTarget().wsBaseUrl;
}

export function resolvePrimaryEnvironmentHttpBaseUrl(): string {
  return resolvePrimaryEnvironmentTarget().httpBaseUrl;
}

export function resolvePrimaryEnvironmentHttpUrl(pathname: string): string {
  const normalizedPath = pathname.startsWith("/") ? pathname.slice(1) : pathname;
  return new URL(
    normalizedPath,
    ensureTrailingSlash(resolvePrimaryEnvironmentHttpBaseUrl()),
  ).toString();
}
