export type OrchestrationRecoveryReason = "bootstrap" | "foreground";

export interface OrchestrationRecoveryPhase {
  kind: "snapshot";
  reason: OrchestrationRecoveryReason;
}

export interface OrchestrationRecoveryState {
  latestSequence: number;
  bootstrapped: boolean;
  inFlight: OrchestrationRecoveryPhase | null;
}

type SequencedEvent = Readonly<{ sequence: number }>;

export function createOrchestrationRecoveryCoordinator() {
  let state: OrchestrationRecoveryState = {
    latestSequence: 0,
    bootstrapped: false,
    inFlight: null,
  };

  const snapshotState = (): OrchestrationRecoveryState => ({
    ...state,
    ...(state.inFlight ? { inFlight: { ...state.inFlight } } : {}),
  });

  return {
    getState(): OrchestrationRecoveryState {
      return snapshotState();
    },

    classifyDomainEvent(sequence: number): "ignore" | "defer" | "apply" {
      if (sequence <= state.latestSequence) {
        return "ignore";
      }
      if (!state.bootstrapped || state.inFlight !== null) {
        return "defer";
      }
      return "apply";
    },

    markEventBatchApplied<T extends SequencedEvent>(events: ReadonlyArray<T>): ReadonlyArray<T> {
      const nextEvents = events
        .filter((event) => event.sequence > state.latestSequence)
        .toSorted((left, right) => left.sequence - right.sequence);
      if (nextEvents.length === 0) {
        return [];
      }

      const contiguousEvents: T[] = [];
      let expectedSequence = state.latestSequence + 1;
      for (const event of nextEvents) {
        if (event.sequence < expectedSequence) {
          continue;
        }
        if (event.sequence > expectedSequence) {
          break;
        }
        contiguousEvents.push(event);
        expectedSequence += 1;
      }

      if (contiguousEvents.length === 0) {
        return [];
      }

      state.latestSequence = contiguousEvents.at(-1)?.sequence ?? state.latestSequence;
      return contiguousEvents;
    },

    beginSnapshotRecovery(reason: OrchestrationRecoveryReason): boolean {
      if (state.inFlight !== null) {
        return false;
      }
      state.inFlight = { kind: "snapshot", reason };
      return true;
    },

    completeSnapshotRecovery(snapshotSequence: number): void {
      state.latestSequence = Math.max(state.latestSequence, snapshotSequence);
      state.bootstrapped = true;
      state.inFlight = null;
    },

    failSnapshotRecovery(): void {
      state.inFlight = null;
    },
  };
}
