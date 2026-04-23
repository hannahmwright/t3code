import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildPairingUrl,
  peekPairingCredentialFromUrl,
  readEnvironmentBootstrapCredential,
  stripPairingCredentialFromUrl,
} from "./serverAuth";

const env = import.meta.env as Record<string, string | undefined>;
const originalWsUrl = env.VITE_WS_URL;

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
  env.VITE_WS_URL = "";
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        href: "https://t3.example.com/?pairingToken=pair-123",
        origin: "https://t3.example.com",
        protocol: "https:",
        host: "t3.example.com",
        hostname: "t3.example.com",
        port: "",
      },
      history: {
        replaceState: (_state: unknown, _title: string, url: string) => {
          window.location.href = url;
        },
      },
    },
  });
  Reflect.deleteProperty(window, "desktopBridge");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      title: "T3 Code",
    },
  });
});

afterEach(() => {
  env.VITE_WS_URL = originalWsUrl;
});

describe("serverAuth helpers", () => {
  it("reads the pairing credential from the current URL", () => {
    expect(peekPairingCredentialFromUrl()).toBe("pair-123");
  });

  it("strips the pairing credential from the current URL", () => {
    stripPairingCredentialFromUrl();
    expect(window.location.href).toBe("https://t3.example.com/");
  });

  it("reads the bootstrap token from the configured websocket url", () => {
    env.VITE_WS_URL = "wss://t3.example.com/?token=bootstrap-123";
    expect(readEnvironmentBootstrapCredential()).toBe("bootstrap-123");
  });

  it("prefers the configured bootstrap token over the desktop bridge token", () => {
    env.VITE_WS_URL = "wss://t3.example.com/?token=bootstrap-123";
    window.desktopBridge = {
      getLocalEnvironmentBootstrap: () => ({
        label: "Local desktop",
        httpBaseUrl: "http://127.0.0.1:4020",
        wsBaseUrl: "ws://127.0.0.1:4020/?token=local-456",
        bootstrapToken: "local-456",
      }),
    } as DesktopBridge;

    expect(readEnvironmentBootstrapCredential()).toBe("bootstrap-123");
  });

  it("reads the bootstrap token from the desktop url fallback", () => {
    setWindowLocation({
      href: "t3://app/index.html?desktopWsBaseUrl=ws%3A%2F%2F127.0.0.1%3A3773%2F%3Ftoken%3Ddesktop-789",
      origin: "null",
      protocol: "t3:",
      host: "",
      hostname: "",
      port: "",
    });

    expect(readEnvironmentBootstrapCredential()).toBe("desktop-789");
  });

  it("builds a pairing URL on the current primary environment", () => {
    expect(buildPairingUrl("pair-456")).toBe("https://t3.example.com/?pairingToken=pair-456");
  });
});
