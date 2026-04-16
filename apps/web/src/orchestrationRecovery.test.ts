import { describe, expect, it } from "vitest";

import { createOrchestrationRecoveryCoordinator } from "./orchestrationRecovery";

describe("createOrchestrationRecoveryCoordinator", () => {
  it("defers domain events until bootstrap completes", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(true);
    expect(coordinator.classifyDomainEvent(4)).toBe("defer");

    coordinator.completeSnapshotRecovery(2);

    expect(coordinator.getState()).toEqual({
      latestSequence: 2,
      bootstrapped: true,
      inFlight: null,
    });
  });

  it("ignores stale events and accepts newer live events once bootstrapped", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    expect(coordinator.classifyDomainEvent(3)).toBe("ignore");
    expect(coordinator.classifyDomainEvent(4)).toBe("apply");
  });

  it("only applies contiguous event prefixes and leaves gaps for reconnect backfill", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    expect(coordinator.markEventBatchApplied([{ sequence: 5 }])).toEqual([]);
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 3,
    });

    expect(
      coordinator.markEventBatchApplied([{ sequence: 5 }, { sequence: 4 }, { sequence: 6 }]),
    ).toEqual([{ sequence: 4 }, { sequence: 5 }, { sequence: 6 }]);
    expect(coordinator.getState()).toMatchObject({
      latestSequence: 6,
    });
  });

  it("blocks overlapping snapshot recoveries", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    expect(coordinator.beginSnapshotRecovery("bootstrap")).toBe(true);
    expect(coordinator.beginSnapshotRecovery("foreground")).toBe(false);
    expect(coordinator.getState().inFlight).toEqual({
      kind: "snapshot",
      reason: "bootstrap",
    });
  });

  it("allows foreground snapshot recovery after bootstrap", () => {
    const coordinator = createOrchestrationRecoveryCoordinator();

    coordinator.beginSnapshotRecovery("bootstrap");
    coordinator.completeSnapshotRecovery(3);

    expect(coordinator.beginSnapshotRecovery("foreground")).toBe(true);
    expect(coordinator.getState().inFlight).toEqual({
      kind: "snapshot",
      reason: "foreground",
    });
  });
});
