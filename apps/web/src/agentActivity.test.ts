import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";
import {
  formatThreadAgentLabel,
  getLatestWorkThreadId,
  getSplitThreadActivityLabel,
  getThreadWorkTimestampMs,
} from "./agentActivity";
import { type Thread } from "./types";

function thread(input: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    codexThreadId: null,
    projectId: null,
    sidechatSourceThreadId: null,
    title: "Thread",
    model: "gpt-5.4",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    detailsLoaded: true,
    error: null,
    createdAt: "2026-03-17T10:00:00.000Z",
    updatedAt: "2026-03-17T10:00:00.000Z",
    latestTurn: null,
    lastVisitedAt: "2026-03-17T10:00:00.000Z",
    branch: null,
    worktreePath: null,
    goal: null,
    turnDiffSummaries: [],
    activities: [],
    ...input,
  };
}

describe("agent activity helpers", () => {
  it("formats provider and model labels", () => {
    expect(
      formatThreadAgentLabel(
        thread({
          id: ThreadId.makeUnsafe("thread-codex"),
          model: "gpt-5.4",
        }),
      ),
    ).toContain("Codex");
    expect(
      formatThreadAgentLabel(
        thread({
          id: ThreadId.makeUnsafe("thread-claude"),
          model: "claude-sonnet-4-6",
          session: {
            provider: "claudeAgent",
            status: "ready",
            orchestrationStatus: "ready",
            createdAt: "2026-03-17T10:00:00.000Z",
            updatedAt: "2026-03-17T10:00:00.000Z",
          },
        }),
      ),
    ).toContain("Claude");
  });

  it("uses turn timestamps before thread update timestamps", () => {
    expect(
      getThreadWorkTimestampMs(
        thread({
          id: ThreadId.makeUnsafe("thread-timestamp"),
          updatedAt: "2026-03-17T12:00:00.000Z",
          latestTurn: {
            turnId: TurnId.makeUnsafe("turn-1"),
            state: "completed",
            requestedAt: "2026-03-17T10:59:00.000Z",
            startedAt: "2026-03-17T11:00:00.000Z",
            completedAt: "2026-03-17T11:05:00.000Z",
            assistantMessageId: null,
          },
        }),
      ),
    ).toBe(Date.parse("2026-03-17T11:05:00.000Z"));
  });

  it("finds the mounted thread with the latest work", () => {
    const olderThread = thread({
      id: ThreadId.makeUnsafe("thread-older"),
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-older"),
        state: "completed",
        requestedAt: "2026-03-17T10:59:00.000Z",
        startedAt: "2026-03-17T11:00:00.000Z",
        completedAt: "2026-03-17T11:05:00.000Z",
        assistantMessageId: null,
      },
    });
    const newerThread = thread({
      id: ThreadId.makeUnsafe("thread-newer"),
      latestTurn: {
        turnId: TurnId.makeUnsafe("turn-newer"),
        state: "running",
        requestedAt: "2026-03-17T11:09:00.000Z",
        startedAt: "2026-03-17T11:10:00.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
    });

    expect(
      getLatestWorkThreadId({
        threads: [olderThread, newerThread],
        threadIds: [olderThread.id, newerThread.id],
      }),
    ).toBe(newerThread.id);
    expect(getSplitThreadActivityLabel(newerThread, newerThread.id)).toBe("Working now");
    expect(getSplitThreadActivityLabel(olderThread, newerThread.id)).toBeNull();
  });
});
