import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolvePrimaryEnvironmentHttpBaseUrl,
  resolvePrimaryEnvironmentHttpUrl,
  resolvePrimaryEnvironmentTarget,
  resolvePrimaryEnvironmentWsUrl,
} from "./primaryEnvironment";

const env = import.meta.env as Record<string, string | undefined>;
const originalHttpUrl = env.VITE_HTTP_URL;
const originalWsUrl = env.VITE_WS_URL;

function resetConfiguredTarget(): void {
  env.VITE_HTTP_URL = "";
  env.VITE_WS_URL = "";
}

function setWindowLocation(value: {
  href: string;
  origin: string;
  protocol: string;
  host: string;
  hostname: string;
  port: string;
}): void {
  Object.defineProperty(window, "location", {
    configurable: true,
    value,
  });
}

beforeEach(() => {
  resetConfiguredTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "https:",
        origin: "https://window.example.com",
        host: "window.example.com",
        hostname: "window.example.com",
        port: "",
      },
    },
  });
  Reflect.deleteProperty(window, "desktopBridge");
});

afterEach(() => {
  env.VITE_HTTP_URL = originalHttpUrl;
  env.VITE_WS_URL = originalWsUrl;
});

describe("primaryEnvironment", () => {
  it("prefers an explicitly configured websocket target over the desktop bridge", () => {
    env.VITE_WS_URL = "wss://shared.example.com/?token=abc123";
    window.desktopBridge = {
      getWsUrl: () => "ws://127.0.0.1:4020",
    } as DesktopBridge;

    expect(resolvePrimaryEnvironmentTarget()).toMatchObject({
      source: "configured",
      httpBaseUrl: "https://shared.example.com",
      wsBaseUrl: "wss://shared.example.com/?token=abc123",
    });
  });

  it("uses desktop bootstrap data when no configured target is present", () => {
    window.desktopBridge = {
      getWsUrl: () => "ws://127.0.0.1:4020",
      getLocalEnvironmentBootstrap: () => ({
        label: "Local desktop",
        httpBaseUrl: "http://127.0.0.1:4020",
        wsBaseUrl: "ws://127.0.0.1:4020",
      }),
    } as DesktopBridge;

    expect(resolvePrimaryEnvironmentWsUrl()).toBe("ws://127.0.0.1:4020");
    expect(resolvePrimaryEnvironmentHttpBaseUrl()).toBe("http://127.0.0.1:4020");
  });

  it("derives an HTTP base URL from the legacy desktop websocket bridge", () => {
    window.desktopBridge = {
      getWsUrl: () => "wss://desktop.example.com/ws?token=desktop",
    } as DesktopBridge;

    expect(resolvePrimaryEnvironmentTarget()).toMatchObject({
      source: "desktop-managed",
      httpBaseUrl: "https://desktop.example.com",
      wsBaseUrl: "wss://desktop.example.com/ws?token=desktop",
    });
  });

  it("uses desktop url bootstrap data when the preload bridge is unavailable", () => {
    setWindowLocation({
      href: "t3://app/index.html?desktopHttpBaseUrl=http%3A%2F%2F127.0.0.1%3A3773&desktopWsBaseUrl=ws%3A%2F%2F127.0.0.1%3A3773%2F%3Ftoken%3Ddesktop-123",
      protocol: "t3:",
      origin: "null",
      host: "",
      hostname: "",
      port: "",
    });

    expect(resolvePrimaryEnvironmentTarget()).toMatchObject({
      source: "desktop-url",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773/?token=desktop-123",
    });
  });

  it("falls back to the shared desktop loopback port for t3 scheme windows", () => {
    setWindowLocation({
      href: "t3://app/index.html",
      protocol: "t3:",
      origin: "null",
      host: "",
      hostname: "",
      port: "",
    });

    expect(resolvePrimaryEnvironmentTarget()).toMatchObject({
      source: "desktop-loopback",
      httpBaseUrl: "http://127.0.0.1:3773",
      wsBaseUrl: "ws://127.0.0.1:3773/",
    });
  });

  it("falls back to the current window origin when nothing else is configured", () => {
    expect(resolvePrimaryEnvironmentWsUrl()).toBe("wss://window.example.com/");
    expect(resolvePrimaryEnvironmentHttpBaseUrl()).toBe("https://window.example.com");
    expect(resolvePrimaryEnvironmentHttpUrl("/api/project-favicon")).toBe(
      "https://window.example.com/api/project-favicon",
    );
  });
});
