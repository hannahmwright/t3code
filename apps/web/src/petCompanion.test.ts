import { describe, expect, it } from "vitest";

import {
  CODEX_PET_STATES,
  DEFAULT_PET_COMPANION_SETTINGS,
  resolveCodexPetUsageSnapshot,
  resolvePetStateFromThreadActivity,
  resolvePetStatusLabel,
  selectPetForSettings,
  shouldShowPetCompanionStatus,
} from "./petCompanion";

describe("petCompanion", () => {
  it("matches the Codex-compatible nine state sprite grid", () => {
    expect(CODEX_PET_STATES.map((state) => state.id)).toEqual([
      "idle",
      "running-right",
      "running-left",
      "waving",
      "jumping",
      "failed",
      "waiting",
      "running",
      "review",
    ]);
  });

  it("selects the stored pet or falls back to the first local pet", () => {
    const pets = [
      { id: "boba", displayName: "Boba", description: null, spritesheetUrl: "/boba.webp" },
      { id: "miso", displayName: "Miso", description: null, spritesheetUrl: "/miso.webp" },
    ];

    expect(selectPetForSettings(pets, DEFAULT_PET_COMPANION_SETTINGS)?.id).toBe("boba");
    expect(selectPetForSettings(pets, { selectedPetId: "miso", collapsed: false })?.id).toBe(
      "miso",
    );
  });

  it("maps thread activity to pet states and labels", () => {
    expect(
      resolvePetStateFromThreadActivity({
        waitingThreadCount: 0,
        runningThreadCount: 2,
        errorThreadCount: 0,
        reviewThreadCount: 0,
      }),
    ).toBe("running");
    expect(
      resolvePetStateFromThreadActivity({
        waitingThreadCount: 0,
        runningThreadCount: 0,
        errorThreadCount: 1,
        reviewThreadCount: 0,
      }),
    ).toBe("failed");
    expect(
      resolvePetStateFromThreadActivity({
        waitingThreadCount: 1,
        runningThreadCount: 1,
        errorThreadCount: 1,
        reviewThreadCount: 1,
      }),
    ).toBe("waiting");
    expect(
      resolvePetStateFromThreadActivity({
        waitingThreadCount: 0,
        runningThreadCount: 0,
        errorThreadCount: 0,
        reviewThreadCount: 1,
      }),
    ).toBe("review");
    expect(
      resolvePetStateFromThreadActivity({
        waitingThreadCount: 0,
        runningThreadCount: 0,
        errorThreadCount: 0,
        reviewThreadCount: 0,
      }),
    ).toBe("idle");
    expect(
      resolvePetStatusLabel({
        waitingThreadCount: 0,
        runningThreadCount: 3,
        errorThreadCount: 0,
        reviewThreadCount: 0,
      }),
    ).toBe("Running 3 threads");
  });

  it("only shows the floating task tray for live agent states", () => {
    expect(shouldShowPetCompanionStatus("running")).toBe(true);
    expect(shouldShowPetCompanionStatus("waiting")).toBe(true);
    expect(shouldShowPetCompanionStatus("failed")).toBe(false);
    expect(shouldShowPetCompanionStatus("review")).toBe(false);
    expect(shouldShowPetCompanionStatus("idle")).toBe(false);
  });

  it("normalizes Codex rate limit buckets for pet rings", () => {
    expect(
      resolveCodexPetUsageSnapshot(
        {
          rate_limits: {
            primary: { used_percent: 24.5 },
            secondary: { remaining_percent: 0.81 },
          },
        },
        "2026-05-04T18:00:00.000Z",
      ),
    ).toEqual({
      source: "runtime",
      updatedAt: "2026-05-04T18:00:00.000Z",
      primary: {
        label: "Short",
        remainingPercent: 75.5,
        usedPercent: 24.5,
      },
      secondary: {
        label: "Weekly",
        remainingPercent: 81,
      },
    });
  });
});
