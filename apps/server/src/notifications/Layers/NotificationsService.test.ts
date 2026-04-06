import { describe, expect, it } from "vitest";

import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import {
  buildNotificationPayload,
  isCompletedAssistantReply,
  shouldSuppressPushForPresence,
} from "./NotificationsService.ts";

const projectId = ProjectId.makeUnsafe("project-notifications");
const threadId = ThreadId.makeUnsafe("thread-notifications");

const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  updatedAt: "2026-04-06T00:00:00.000Z",
  projects: [
    {
      id: projectId,
      title: "Workspace",
      emoji: null,
      groupName: null,
      groupEmoji: null,
      workspaceRoot: "/tmp/t3code",
      defaultModelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      scripts: [],
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      deletedAt: null,
    },
  ],
  threads: [
    {
      id: threadId,
      projectId,
      title: "Ship the PWA",
      modelSelection: {
        provider: "codex",
        model: "gpt-5-codex",
      },
      interactionMode: "default",
      runtimeMode: "full-access",
      branch: null,
      worktreePath: null,
      createdAt: "2026-04-06T00:00:00.000Z",
      updatedAt: "2026-04-06T00:00:00.000Z",
      archivedAt: null,
      latestTurn: null,
      messages: [],
      session: null,
      activities: [],
      proposedPlans: [],
      checkpoints: [],
      deletedAt: null,
    },
  ],
};

const makeMessageEvent = (input: {
  readonly role: "assistant" | "user";
  readonly streaming: boolean;
  readonly text: string;
}): OrchestrationEvent => ({
  sequence: 2,
  eventId: EventId.makeUnsafe(`evt-${input.role}-${input.streaming ? "streaming" : "done"}`),
  aggregateKind: "thread",
  aggregateId: threadId,
  occurredAt: "2026-04-06T00:01:00.000Z",
  commandId: CommandId.makeUnsafe("cmd-notifications"),
  causationEventId: null,
  correlationId: null,
  metadata: {},
  type: "thread.message-sent",
  payload: {
    threadId,
    turnId: null,
    messageId: MessageId.makeUnsafe(`message-${input.role}-${input.streaming ? "streaming" : "done"}`),
    role: input.role,
    text: input.text,
    createdAt: "2026-04-06T00:01:00.000Z",
    updatedAt: "2026-04-06T00:01:05.000Z",
    streaming: input.streaming,
    attachments: [],
  },
});

describe("NotificationsService helpers", () => {
  it("treats only completed assistant replies as push-worthy", () => {
    expect(
      isCompletedAssistantReply(
        makeMessageEvent({
          role: "assistant",
          streaming: false,
          text: "done",
        }),
      ),
    ).toBe(true);

    expect(
      isCompletedAssistantReply(
        makeMessageEvent({
          role: "assistant",
          streaming: true,
          text: "partial",
        }),
      ),
    ).toBe(false);

    expect(
      isCompletedAssistantReply(
        makeMessageEvent({
          role: "user",
          streaming: false,
          text: "hello",
        }),
      ),
    ).toBe(false);
  });

  it("builds a thread-scoped notification payload with a trimmed preview", () => {
    const payload = buildNotificationPayload(
      makeMessageEvent({
        role: "assistant",
        streaming: false,
        text: "   Completed   assistant   reply   with extra whitespace.   ",
      }),
      readModel,
    );

    expect(payload).toEqual({
      title: "Ship the PWA",
      body: "Completed assistant reply with extra whitespace.",
      tag: `thread:${threadId}`,
      url: `/${encodeURIComponent(threadId)}`,
      threadId,
    });
  });

  it("suppresses push only when the same installation is visible on the same thread", () => {
    expect(
      shouldSuppressPushForPresence(
        {
          activeThreadId: threadId,
          visible: true,
          updatedAtMs: Date.now(),
        },
        threadId,
      ),
    ).toBe(true);

    expect(
      shouldSuppressPushForPresence(
        {
          activeThreadId: threadId,
          visible: false,
          updatedAtMs: Date.now(),
        },
        threadId,
      ),
    ).toBe(false);

    expect(
      shouldSuppressPushForPresence(
        {
          activeThreadId: ThreadId.makeUnsafe("thread-other"),
          visible: true,
          updatedAtMs: Date.now(),
        },
        threadId,
      ),
    ).toBe(false);
  });
});
