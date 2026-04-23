import { ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildThreadNotificationUrl,
  buildTurnCompletionNotification,
  getTurnCompletionNotificationCandidate,
} from "./TurnCompletionNotifications";
import type { Project, Thread } from "./types";

function makeProject(): Project {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    name: "Workspace",
    emoji: null,
    color: null,
    groupName: null,
    groupEmoji: null,
    cwd: "/tmp/workspace",
    model: "gpt-5.4",
    expanded: true,
    scripts: [],
  };
}

function makeThread(
  overrides: Partial<Thread> = {},
  latestTurnOverrides: Partial<NonNullable<Thread["latestTurn"]>> = {},
): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Fix sync",
    model: "gpt-5.4",
    runtimeMode: "full-access",
    interactionMode: "default",
    session: {
      provider: "codex",
      status: "ready",
      orchestrationStatus: "ready",
      activeTurnId: undefined,
      createdAt: "2026-04-15T12:00:00.000Z",
      updatedAt: "2026-04-15T12:03:00.000Z",
    },
    messages: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-04-15T12:00:00.000Z",
    updatedAt: "2026-04-15T12:03:00.000Z",
    latestTurn: {
      turnId: TurnId.makeUnsafe("turn-1"),
      state: "completed",
      requestedAt: "2026-04-15T12:00:00.000Z",
      startedAt: "2026-04-15T12:00:02.000Z",
      completedAt: "2026-04-15T12:03:00.000Z",
      assistantMessageId: null,
      ...latestTurnOverrides,
    },
    lastVisitedAt: "2026-04-15T12:00:00.000Z",
    branch: null,
    worktreePath: null,
    turnDiffSummaries: [],
    activities: [],
    ...overrides,
  };
}

describe("TurnCompletionNotifications", () => {
  it("builds a thread URL rooted at the current origin", () => {
    expect(buildThreadNotificationUrl(ThreadId.makeUnsafe("thread-1"), "https://example.com")).toBe(
      "https://example.com/thread-1",
    );
  });

  it("creates a notification candidate for settled turns", () => {
    const candidate = getTurnCompletionNotificationCandidate({
      thread: makeThread({
        messages: [
          {
            id: "assistant-1" as Thread["messages"][number]["id"],
            role: "assistant",
            text: "Done. Tests are passing.",
            turnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-04-15T12:02:00.000Z",
            completedAt: "2026-04-15T12:03:00.000Z",
            streaming: false,
          },
        ],
      }),
      project: makeProject(),
      origin: "https://example.com",
    });

    expect(candidate).toMatchObject({
      key: "turn-1:2026-04-15T12:03:00.000Z",
      threadTitle: "Fix sync",
      notification: {
        title: "Fix sync",
        body: "Workspace • Done. Tests are passing.",
        tag: "t3code:turn-complete:thread-1",
        url: "https://example.com/thread-1",
      },
    });
  });

  it("still emits when the session lags behind a completed turn", () => {
    const candidate = getTurnCompletionNotificationCandidate({
      thread: makeThread(
        {
          session: {
            provider: "codex",
            status: "running",
            orchestrationStatus: "running",
            activeTurnId: TurnId.makeUnsafe("turn-1"),
            createdAt: "2026-04-15T12:00:00.000Z",
            updatedAt: "2026-04-15T12:02:00.000Z",
          },
        },
        {
          completedAt: "2026-04-15T12:03:00.000Z",
        },
      ),
      project: makeProject(),
      origin: "https://example.com",
    });

    expect(candidate).not.toBeNull();
    expect(candidate?.notification.title).toBe("Fix sync");
  });

  it("does not emit for interrupted turns created from placeholder checkpoints", () => {
    const candidate = getTurnCompletionNotificationCandidate({
      thread: makeThread(
        {},
        {
          state: "interrupted",
        },
      ),
      project: makeProject(),
      origin: "https://example.com",
    });

    expect(candidate).toBeNull();
  });

  it("collapses multiple completed turns into a single summary notification", () => {
    const first = getTurnCompletionNotificationCandidate({
      thread: makeThread(),
      project: makeProject(),
      origin: "https://example.com",
    });
    const second = getTurnCompletionNotificationCandidate({
      thread: makeThread(
        {
          id: ThreadId.makeUnsafe("thread-2"),
          title: "Review PR",
        },
        {
          turnId: TurnId.makeUnsafe("turn-2"),
          completedAt: "2026-04-15T12:05:00.000Z",
        },
      ),
      project: makeProject(),
      origin: "https://example.com",
    });
    if (!first || !second) {
      throw new Error("Expected notification candidates");
    }

    const notification = buildTurnCompletionNotification({
      candidates: [first, second],
    });

    expect(notification).toEqual({
      title: "2 turns finished",
      body: "Review PR",
      tag: "t3code:turn-complete:batch",
      renotify: true,
      url: "https://example.com/thread-2",
    });
  });
});
