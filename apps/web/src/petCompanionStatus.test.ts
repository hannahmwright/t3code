import { MessageId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { derivePetCompanionRuntimeSnapshot } from "./petCompanionStatus";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

const BASE_TIME = "2026-05-05T20:00:00.000Z";

function makeThread(id: string, overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe(id),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: id,
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    proposedPlans: [],
    detailsLoaded: true,
    error: null,
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME,
    latestTurn: null,
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

function makeRunningThread(id = "running-thread"): Thread {
  const turnId = TurnId.makeUnsafe(`${id}-turn`);
  return makeThread(id, {
    latestTurn: {
      turnId,
      state: "running",
      requestedAt: BASE_TIME,
      startedAt: BASE_TIME,
      completedAt: null,
      assistantMessageId: null,
    },
    session: {
      provider: "codex",
      status: "running",
      activeTurnId: turnId,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
      orchestrationStatus: "running",
    },
  });
}

it("prefers live running work over an old errored thread", () => {
  const staleError = makeThread("stale-error", {
    title: "Face management UI redesign",
    updatedAt: "2026-04-14T04:52:31.442Z",
    latestTurn: {
      turnId: TurnId.makeUnsafe("stale-error-turn"),
      state: "error",
      requestedAt: "2026-04-14T04:52:00.000Z",
      startedAt: "2026-04-14T04:52:01.249Z",
      completedAt: "2026-04-14T04:52:31.442Z",
      assistantMessageId: null,
    },
    session: {
      provider: "codex",
      status: "error",
      activeTurnId: undefined,
      createdAt: "2026-04-14T04:52:00.000Z",
      updatedAt: "2026-04-14T04:52:31.442Z",
      lastError: "[ede_diagnostic] result_type=user",
      orchestrationStatus: "error",
    },
  });

  const snapshot = derivePetCompanionRuntimeSnapshot([staleError, makeRunningThread()]);

  expect(snapshot.petState).toBe("running");
  expect(snapshot.statusThread?.id).toBe(ThreadId.makeUnsafe("running-thread"));
});

it("does not treat a persisted running latest turn as live when the session is ready", () => {
  const staleRunning = makeThread("stale-running", {
    latestTurn: {
      turnId: TurnId.makeUnsafe("stale-running-turn"),
      state: "running",
      requestedAt: "2026-04-16T18:00:30.000Z",
      startedAt: "2026-04-16T18:00:31.084Z",
      completedAt: null,
      assistantMessageId: null,
    },
    session: {
      provider: "codex",
      status: "ready",
      activeTurnId: TurnId.makeUnsafe("stale-running-turn"),
      createdAt: "2026-04-16T18:00:30.000Z",
      updatedAt: "2026-05-01T22:14:50.137Z",
      orchestrationStatus: "ready",
    },
  });

  const snapshot = derivePetCompanionRuntimeSnapshot([staleRunning]);

  expect(snapshot.petState).toBe("idle");
  expect(snapshot.statusThread).toBeNull();
});

it("uses streaming assistant text as live work even before session status catches up", () => {
  const streaming = makeThread("streaming", {
    messages: [
      {
        id: MessageId.makeUnsafe("message-1"),
        role: "assistant",
        text: "",
        createdAt: BASE_TIME,
        streaming: true,
      },
    ],
  });

  expect(derivePetCompanionRuntimeSnapshot([streaming]).petState).toBe("running");
});

describe("active-thread failures", () => {
  it("only shows failed state for the active route thread", () => {
    const failed = makeThread("failed", {
      error: "Something went wrong.",
      session: {
        provider: "codex",
        status: "error",
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
        orchestrationStatus: "error",
      },
    });

    expect(derivePetCompanionRuntimeSnapshot([failed]).petState).toBe("idle");
    expect(derivePetCompanionRuntimeSnapshot([failed], failed.id).petState).toBe("failed");
  });
});
