import { describe, expect, it } from "vitest";

import type { WsConnectionStatus } from "../rpc/wsConnectionState";
import {
  shouldAutoReconnect,
  shouldBlockInitialConnectionUi,
  shouldSuppressReconnectUi,
} from "./WebSocketConnectionSurface";

function makeStatus(overrides: Partial<WsConnectionStatus> = {}): WsConnectionStatus {
  return {
    attemptCount: 0,
    closeCode: null,
    closeReason: null,
    connectedAt: null,
    disconnectedAt: null,
    hasConnected: false,
    lastError: null,
    lastErrorAt: null,
    nextRetryAt: null,
    online: true,
    phase: "idle",
    reconnectAttemptCount: 0,
    reconnectMaxAttempts: 8,
    reconnectPhase: "idle",
    socketUrl: null,
    ...overrides,
  };
}

describe("WebSocketConnectionSurface.logic", () => {
  it("forces reconnect on online when the app was offline", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          disconnectedAt: "2026-04-03T20:00:00.000Z",
          online: false,
          phase: "disconnected",
        }),
        "online",
      ),
    ).toBe(true);
  });

  it("forces reconnect on focus only for previously connected disconnected states", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 3,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(true);

    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: false,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 1,
          reconnectPhase: "waiting",
        }),
        "focus",
      ),
    ).toBe(false);
  });

  it("forces reconnect on focus for exhausted reconnect loops", () => {
    expect(
      shouldAutoReconnect(
        makeStatus({
          hasConnected: true,
          online: true,
          phase: "disconnected",
          reconnectAttemptCount: 8,
          reconnectPhase: "exhausted",
        }),
        "focus",
      ),
    ).toBe(true);
  });

  it("suppresses reconnect ui while the app is hidden", () => {
    expect(
      shouldSuppressReconnectUi({
        hasConnected: true,
        hidden: true,
        nowMs: 10_000,
        lastForegroundResumeAtMs: 0,
      }),
    ).toBe(true);
  });

  it("suppresses reconnect ui briefly after returning to foreground", () => {
    expect(
      shouldSuppressReconnectUi({
        hasConnected: true,
        hidden: false,
        nowMs: 10_000,
        lastForegroundResumeAtMs: 5_000,
      }),
    ).toBe(true);

    expect(
      shouldSuppressReconnectUi({
        hasConnected: true,
        hidden: false,
        nowMs: 20_000,
        lastForegroundResumeAtMs: 5_000,
      }),
    ).toBe(false);
  });

  it("does not suppress reconnect ui before the first successful connection", () => {
    expect(
      shouldSuppressReconnectUi({
        hasConnected: false,
        hidden: false,
        nowMs: 10_000,
        lastForegroundResumeAtMs: 5_000,
      }),
    ).toBe(false);
  });

  it("waits for the initial connection grace period before blocking the app", () => {
    expect(
      shouldBlockInitialConnectionUi({
        hasServerConfig: false,
        waitingForGracePeriod: true,
      }),
    ).toBe(false);

    expect(
      shouldBlockInitialConnectionUi({
        hasServerConfig: false,
        waitingForGracePeriod: false,
      }),
    ).toBe(true);

    expect(
      shouldBlockInitialConnectionUi({
        hasServerConfig: true,
        waitingForGracePeriod: false,
      }),
    ).toBe(false);
  });
});
