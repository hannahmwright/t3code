import { describe, expect, it } from "vitest";

import {
  CommandId,
  EventId,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationEvent,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import {
  buildNotificationPayload,
  isCompletedAssistantReply,
  isLatestCompletedAssistantMessageForTurn,
  isThreadWaitingOnUserReply,
  shouldSuppressPushForPresence,
} from "./NotificationsService.ts";

const projectId = ProjectId.makeUnsafe("project-notifications");
const threadId = ThreadId.makeUnsafe("thread-notifications");
const turnId = TurnId.makeUnsafe("turn-1");

const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  updatedAt: "2026-04-06T00:00:00.000Z",
  projects: [
    {
      id: projectId,
      title: "Workspace",
      emoji: null,
      color: null,
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

type ThreadMessageSentEvent = Extract<OrchestrationEvent, { type: "thread.message-sent" }>;

const makeMessageEvent = (input: {
  readonly role: "assistant" | "user";
  readonly streaming: boolean;
  readonly text: string;
  readonly turnId?: TurnId;
  readonly messageId?: MessageId;
}): ThreadMessageSentEvent => ({
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
    turnId: input.turnId ?? null,
    messageId:
      input.messageId ??
      MessageId.makeUnsafe(`message-${input.role}-${input.streaming ? "streaming" : "done"}`),
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
          turnId,
        }),
      ),
    ).toBe(true);

    expect(
      isCompletedAssistantReply(
        makeMessageEvent({
          role: "assistant",
          streaming: true,
          text: "partial",
          turnId,
        }),
      ),
    ).toBe(false);

    expect(
      isCompletedAssistantReply(
        makeMessageEvent({
          role: "user",
          streaming: false,
          text: "hello",
          turnId,
        }),
      ),
    ).toBe(false);

    expect(
      isCompletedAssistantReply(
        makeMessageEvent({
          role: "assistant",
          streaming: false,
          text: "ambient",
        }),
      ),
    ).toBe(false);
  });

  it("builds a thread-scoped notification payload from the stored assistant message text", () => {
    const finalMessageId = MessageId.makeUnsafe("message-assistant-final");
    const event = makeMessageEvent({
      role: "assistant",
      streaming: false,
      text: "",
      turnId,
      messageId: finalMessageId,
    });
    const payload = buildNotificationPayload(event, {
      ...readModel,
      threads: readModel.threads.map((thread) =>
        thread.id !== threadId
          ? thread
          : {
              ...thread,
              messages: [
                {
                  id: finalMessageId,
                  role: "assistant",
                  text: "   Completed   assistant   reply   with extra whitespace.   ",
                  attachments: [],
                  turnId,
                  streaming: false,
                  createdAt: "2026-04-06T00:01:00.000Z",
                  updatedAt: "2026-04-06T00:01:05.000Z",
                },
              ],
            },
      ),
    });

    expect(payload).toEqual({
      title: "Ship the PWA",
      body: "Completed assistant reply with extra whitespace.",
      tag: `thread:${threadId}`,
      url: `/${encodeURIComponent(threadId)}`,
      threadId,
    });
  });

  it("notifies only when the thread is ready and waiting on the user", () => {
    const event = makeMessageEvent({
      role: "assistant",
      streaming: false,
      text: "done",
      turnId,
    });

    expect(
      isThreadWaitingOnUserReply(event, {
        ...readModel,
        threads: readModel.threads.map((thread) =>
          thread.id !== threadId
            ? thread
            : {
                ...thread,
                session: {
                  threadId,
                  status: "ready",
                  providerName: "Codex",
                  runtimeMode: "full-access",
                  activeTurnId: null,
                  lastError: null,
                  updatedAt: "2026-04-06T00:01:10.000Z",
                },
              },
        ),
      }),
    ).toBe(true);

    expect(
      isThreadWaitingOnUserReply(event, {
        ...readModel,
        threads: readModel.threads.map((thread) =>
          thread.id !== threadId
            ? thread
            : {
                ...thread,
                session: {
                  threadId,
                  status: "running",
                  providerName: "Codex",
                  runtimeMode: "full-access",
                  activeTurnId: turnId,
                  lastError: null,
                  updatedAt: "2026-04-06T00:01:10.000Z",
                },
              },
        ),
      }),
    ).toBe(false);
  });

  it("requires the notification candidate to still be the latest completed assistant message for the turn", () => {
    const firstMessageId = MessageId.makeUnsafe("message-assistant-first");
    const lastMessageId = MessageId.makeUnsafe("message-assistant-last");
    const event = makeMessageEvent({
      role: "assistant",
      streaming: false,
      text: "",
      turnId,
      messageId: firstMessageId,
    });

    expect(
      isLatestCompletedAssistantMessageForTurn(event, {
        ...readModel,
        threads: readModel.threads.map((thread) =>
          thread.id !== threadId
            ? thread
            : {
                ...thread,
                messages: [
                  {
                    id: firstMessageId,
                    role: "assistant",
                    text: "First",
                    attachments: [],
                    turnId,
                    streaming: false,
                    createdAt: "2026-04-06T00:01:00.000Z",
                    updatedAt: "2026-04-06T00:01:01.000Z",
                  },
                  {
                    id: lastMessageId,
                    role: "assistant",
                    text: "Last",
                    attachments: [],
                    turnId,
                    streaming: false,
                    createdAt: "2026-04-06T00:01:02.000Z",
                    updatedAt: "2026-04-06T00:01:03.000Z",
                  },
                ],
              },
        ),
      }),
    ).toBe(false);
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
