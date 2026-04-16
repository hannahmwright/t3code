import { describe, expect, it } from "vitest";

import { shouldRecoverActiveThreadSnapshot } from "./threadSnapshotRecovery";

describe("shouldRecoverActiveThreadSnapshot", () => {
  it("requires an active visible browser thread", () => {
    expect(
      shouldRecoverActiveThreadSnapshot({
        bootstrapComplete: false,
        draftThreadExists: false,
        routeThreadExists: true,
        isElectron: false,
        visibilityState: "visible",
        thread: null,
      }),
    ).toBe(false);

    expect(
      shouldRecoverActiveThreadSnapshot({
        bootstrapComplete: true,
        draftThreadExists: false,
        routeThreadExists: true,
        isElectron: false,
        visibilityState: "hidden",
        thread: {
          session: { status: "running" } as never,
          latestTurn: null,
        },
      }),
    ).toBe(false);

    expect(
      shouldRecoverActiveThreadSnapshot({
        bootstrapComplete: true,
        draftThreadExists: false,
        routeThreadExists: true,
        isElectron: true,
        visibilityState: "visible",
        thread: {
          session: { status: "running" } as never,
          latestTurn: null,
        },
      }),
    ).toBe(false);
  });

  it("runs while the server still thinks the session or turn is running", () => {
    expect(
      shouldRecoverActiveThreadSnapshot({
        bootstrapComplete: true,
        draftThreadExists: false,
        routeThreadExists: true,
        isElectron: false,
        visibilityState: "visible",
        thread: {
          session: { status: "running" } as never,
          latestTurn: null,
        },
      }),
    ).toBe(true);

    expect(
      shouldRecoverActiveThreadSnapshot({
        bootstrapComplete: true,
        draftThreadExists: false,
        routeThreadExists: true,
        isElectron: false,
        visibilityState: "visible",
        thread: {
          session: { status: "ready" } as never,
          latestTurn: { state: "running" } as never,
        },
      }),
    ).toBe(true);
  });

  it("stops once the thread is settled", () => {
    expect(
      shouldRecoverActiveThreadSnapshot({
        bootstrapComplete: true,
        draftThreadExists: false,
        routeThreadExists: true,
        isElectron: false,
        visibilityState: "visible",
        thread: {
          session: { status: "ready" } as never,
          latestTurn: { state: "completed" } as never,
        },
      }),
    ).toBe(false);
  });
});
