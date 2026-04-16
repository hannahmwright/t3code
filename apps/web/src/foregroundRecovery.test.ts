import { describe, expect, it } from "vitest";

import {
  FOREGROUND_SNAPSHOT_RECOVERY_MIN_INTERVAL_MS,
  shouldRunForegroundSnapshotRecovery,
} from "./foregroundRecovery";

describe("shouldRunForegroundSnapshotRecovery", () => {
  it("requires the page to be visible and previously backgrounded", () => {
    expect(
      shouldRunForegroundSnapshotRecovery({
        isVisible: false,
        pendingBackgroundedAtMs: 100,
        lastForegroundRecoveryAtMs: null,
        nowMs: 200,
      }),
    ).toBe(false);

    expect(
      shouldRunForegroundSnapshotRecovery({
        isVisible: true,
        pendingBackgroundedAtMs: null,
        lastForegroundRecoveryAtMs: null,
        nowMs: 200,
      }),
    ).toBe(false);
  });

  it("runs once when returning from the background", () => {
    expect(
      shouldRunForegroundSnapshotRecovery({
        isVisible: true,
        pendingBackgroundedAtMs: 100,
        lastForegroundRecoveryAtMs: null,
        nowMs: 200,
      }),
    ).toBe(true);
  });

  it("debounces duplicate foreground resumptions", () => {
    expect(
      shouldRunForegroundSnapshotRecovery({
        isVisible: true,
        pendingBackgroundedAtMs: 100,
        lastForegroundRecoveryAtMs: 200,
        nowMs: 200 + FOREGROUND_SNAPSHOT_RECOVERY_MIN_INTERVAL_MS - 1,
      }),
    ).toBe(false);

    expect(
      shouldRunForegroundSnapshotRecovery({
        isVisible: true,
        pendingBackgroundedAtMs: 100,
        lastForegroundRecoveryAtMs: 200,
        nowMs: 200 + FOREGROUND_SNAPSHOT_RECOVERY_MIN_INTERVAL_MS,
      }),
    ).toBe(true);
  });
});
