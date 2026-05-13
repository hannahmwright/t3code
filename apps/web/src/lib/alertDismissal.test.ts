import { describe, expect, it } from "vitest";

import {
  ARM64_INTEL_BUILD_ALERT_KEY,
  buildProviderHealthAlertKey,
  dismissAlertKey,
} from "./alertDismissal";

describe("alertDismissal", () => {
  it("deduplicates dismissed alert keys", () => {
    expect(dismissAlertKey(["alpha"], "alpha")).toEqual(["alpha"]);
    expect(dismissAlertKey(["alpha"], "beta")).toEqual(["alpha", "beta"]);
  });

  it("builds a stable provider-health dismissal key from status details", () => {
    expect(
      buildProviderHealthAlertKey({
        provider: "codex",
        status: "error",
        available: false,
        authStatus: "unknown",
        checkedAt: "2026-05-03T21:30:00.000Z",
        message: "Codex CLI (`codex`) is not installed or not on PATH.",
      }),
    ).toBe(
      "provider-health:codex:error:unknown:Codex CLI (`codex`) is not installed or not on PATH.",
    );
  });

  it("exposes a stable dismissal key for the Intel-build desktop warning", () => {
    expect(ARM64_INTEL_BUILD_ALERT_KEY).toBe("desktop-runtime:arm64-intel-build-warning");
  });
});
