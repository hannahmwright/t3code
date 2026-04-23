import type {
  OrchestrationEvent,
  OrchestrationReadModel,
  OrchestrationWorkbook,
  ThreadId,
} from "@t3tools/contracts";
import {
  OrchestrationCheckpointSummary,
  OrchestrationMessage,
  OrchestrationSession,
  OrchestrationThread,
} from "@t3tools/contracts";
import { Effect, Schema } from "effect";

import { toProjectorDecodeError, type OrchestrationProjectorDecodeError } from "./Errors.ts";
import {
  WorkbookCreatedPayload,
  WorkbookDeletedPayload,
  WorkbookMetaUpdatedPayload,
  MessageSentPayloadSchema,
  ProjectCreatedPayload,
  ProjectDeletedPayload,
  ProjectMetaUpdatedPayload,
  ThreadActivityAppendedPayload,
  ThreadCreatedPayload,
  ThreadDeletedPayload,
  ThreadInteractionModeSetPayload,
  ThreadMetaUpdatedPayload,
  ThreadProposedPlanUpsertedPayload,
  ThreadTurnInterruptRequestedPayload,
  ThreadTurnStartRequestedPayload,
  ThreadRuntimeModeSetPayload,
  ThreadRevertedPayload,
  ThreadSessionSetPayload,
  ThreadTurnDiffCompletedPayload,
} from "./Schemas.ts";

type ThreadPatch = Partial<Omit<OrchestrationThread, "id" | "projectId">>;
const MAX_THREAD_MESSAGES = 2_000;
const MAX_THREAD_CHECKPOINTS = 500;

function checkpointStatusToLatestTurnState(status: "ready" | "missing" | "error") {
  if (status === "error") return "error" as const;
  if (status === "missing") return "interrupted" as const;
  return "completed" as const;
}

function updateThread(
  threads: ReadonlyArray<OrchestrationThread>,
  threadId: ThreadId,
  patch: ThreadPatch,
): OrchestrationThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...patch } : thread));
}

function upsertWorkbook(
  workbooks: ReadonlyArray<OrchestrationWorkbook>,
  workbook: OrchestrationWorkbook,
): OrchestrationWorkbook[] {
  const existing = workbooks.find((entry) => entry.id === workbook.id);
  if (!existing) {
    return [...workbooks, workbook];
  }
  return workbooks.map((entry) => (entry.id === workbook.id ? workbook : entry));
}

function resolveWorkbookMetadata(
  workbooks: ReadonlyArray<OrchestrationWorkbook>,
  input: {
    workbookId: OrchestrationReadModel["projects"][number]["workbookId"];
    groupName: string | null;
    groupEmoji: string | null;
  },
): {
  groupName: string | null;
  groupEmoji: string | null;
} {
  if (input.workbookId === null) {
    return {
      groupName: input.groupName,
      groupEmoji: input.groupEmoji,
    };
  }
  const workbook = workbooks.find(
    (entry) => entry.id === input.workbookId && entry.deletedAt === null,
  );
  if (!workbook) {
    return {
      groupName: input.groupName,
      groupEmoji: input.groupEmoji,
    };
  }
  return {
    groupName: workbook.name,
    groupEmoji: workbook.emoji,
  };
}

function deriveSessionCanInterrupt(input: {
  session: OrchestrationSession;
  latestTurn: OrchestrationThread["latestTurn"];
  previousCanInterrupt?: boolean;
}): boolean {
  const previousCanInterrupt = input.previousCanInterrupt ?? false;
  const latestTurnSettled =
    input.latestTurn?.completedAt !== null && input.latestTurn?.completedAt !== undefined;

  switch (input.session.status) {
    case "running":
      return (
        input.session.activeTurnId !== null ||
        previousCanInterrupt ||
        input.latestTurn?.completedAt === null
      );
    case "starting":
    case "ready":
      return previousCanInterrupt && !latestTurnSettled;
    default:
      return false;
  }
}

function decodeForEvent<A>(
  schema: Schema.Schema<A>,
  value: unknown,
  eventType: OrchestrationEvent["type"],
  field: string,
): Effect.Effect<A, OrchestrationProjectorDecodeError> {
  return Effect.try({
    try: () => Schema.decodeUnknownSync(schema as any)(value),
    catch: (error) => toProjectorDecodeError(`${eventType}:${field}`)(error as Schema.SchemaError),
  });
}

function retainThreadMessagesAfterRevert(
  messages: ReadonlyArray<OrchestrationMessage>,
  retainedTurnIds: ReadonlySet<string>,
  turnCount: number,
): ReadonlyArray<OrchestrationMessage> {
  const retainedMessageIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "system") {
      retainedMessageIds.add(message.id);
      continue;
    }
    if (message.turnId !== null && retainedTurnIds.has(message.turnId)) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedUserCount = messages.filter(
    (message) => message.role === "user" && retainedMessageIds.has(message.id),
  ).length;
  const missingUserCount = Math.max(0, turnCount - retainedUserCount);
  if (missingUserCount > 0) {
    const fallbackUserMessages = messages
      .filter(
        (message) =>
          message.role === "user" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingUserCount);
    for (const message of fallbackUserMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  const retainedAssistantCount = messages.filter(
    (message) => message.role === "assistant" && retainedMessageIds.has(message.id),
  ).length;
  const missingAssistantCount = Math.max(0, turnCount - retainedAssistantCount);
  if (missingAssistantCount > 0) {
    const fallbackAssistantMessages = messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !retainedMessageIds.has(message.id) &&
          (message.turnId === null || retainedTurnIds.has(message.turnId)),
      )
      .toSorted(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
      )
      .slice(0, missingAssistantCount);
    for (const message of fallbackAssistantMessages) {
      retainedMessageIds.add(message.id);
    }
  }

  return messages.filter((message) => retainedMessageIds.has(message.id));
}

function retainThreadActivitiesAfterRevert(
  activities: ReadonlyArray<OrchestrationThread["activities"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["activities"][number]> {
  return activities.filter(
    (activity) => activity.turnId === null || retainedTurnIds.has(activity.turnId),
  );
}

function retainThreadProposedPlansAfterRevert(
  proposedPlans: ReadonlyArray<OrchestrationThread["proposedPlans"][number]>,
  retainedTurnIds: ReadonlySet<string>,
): ReadonlyArray<OrchestrationThread["proposedPlans"][number]> {
  return proposedPlans.filter(
    (proposedPlan) => proposedPlan.turnId === null || retainedTurnIds.has(proposedPlan.turnId),
  );
}

function compareThreadActivities(
  left: OrchestrationThread["activities"][number],
  right: OrchestrationThread["activities"][number],
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }

  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

export function createEmptyReadModel(nowIso: string): OrchestrationReadModel {
  return {
    snapshotSequence: 0,
    workbooks: [],
    projects: [],
    threads: [],
    updatedAt: nowIso,
  };
}

export function projectEvent(
  model: OrchestrationReadModel,
  event: OrchestrationEvent,
): Effect.Effect<OrchestrationReadModel, OrchestrationProjectorDecodeError> {
  const nextBase: OrchestrationReadModel = {
    ...model,
    workbooks: model.workbooks ?? [],
    snapshotSequence: event.sequence,
    updatedAt: event.occurredAt,
  };
  const currentWorkbooks = nextBase.workbooks ?? [];

  switch (event.type) {
    case "workbook.created":
      return decodeForEvent(WorkbookCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const nextWorkbook = {
            id: payload.workbookId,
            name: payload.name,
            emoji: payload.emoji,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          } satisfies OrchestrationWorkbook;

          return {
            ...nextBase,
            workbooks: upsertWorkbook(currentWorkbooks, nextWorkbook),
          };
        }),
      );

    case "workbook.meta-updated":
      return decodeForEvent(WorkbookMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          workbooks: currentWorkbooks.map((workbook) =>
            workbook.id === payload.workbookId
              ? {
                  ...workbook,
                  ...(payload.name !== undefined ? { name: payload.name } : {}),
                  ...(payload.emoji !== undefined ? { emoji: payload.emoji } : {}),
                  updatedAt: payload.updatedAt,
                }
              : workbook,
          ),
          projects: nextBase.projects.map((project) => {
            if (project.workbookId !== payload.workbookId) {
              return project;
            }
            const nextGroupName = payload.name ?? project.groupName;
            const nextGroupEmoji = payload.emoji !== undefined ? payload.emoji : project.groupEmoji;
            return {
              ...project,
              groupName: nextGroupName,
              groupEmoji: nextGroupEmoji,
              updatedAt: payload.updatedAt,
            };
          }),
        })),
      );

    case "workbook.deleted":
      return decodeForEvent(WorkbookDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          workbooks: currentWorkbooks.map((workbook) =>
            workbook.id === payload.workbookId
              ? {
                  ...workbook,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : workbook,
          ),
        })),
      );

    case "project.created":
      return decodeForEvent(ProjectCreatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const workbookId = payload.workbookId ?? null;
          const existing = nextBase.projects.find((entry) => entry.id === payload.projectId);
          const nextWorkbooks =
            workbookId !== null &&
            !currentWorkbooks.some((entry) => entry.id === workbookId) &&
            payload.groupName !== null
              ? upsertWorkbook(currentWorkbooks, {
                  id: workbookId,
                  name: payload.groupName,
                  emoji: payload.groupEmoji ?? null,
                  createdAt: payload.createdAt,
                  updatedAt: payload.updatedAt,
                  deletedAt: null,
                })
              : [...currentWorkbooks];
          const workbookMetadata = resolveWorkbookMetadata(nextWorkbooks, {
            workbookId,
            groupName: payload.groupName,
            groupEmoji: payload.groupEmoji ?? null,
          });
          const nextProject = {
            id: payload.projectId,
            title: payload.title,
            emoji: payload.emoji,
            color: payload.color ?? null,
            workbookId,
            groupName: workbookMetadata.groupName,
            groupEmoji: workbookMetadata.groupEmoji,
            workspaceRoot: payload.workspaceRoot,
            defaultModel: payload.defaultModel,
            scripts: payload.scripts,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
          };

          return {
            ...nextBase,
            workbooks: nextWorkbooks,
            projects: existing
              ? nextBase.projects.map((entry) =>
                  entry.id === payload.projectId ? nextProject : entry,
                )
              : [...nextBase.projects, nextProject],
          };
        }),
      );

    case "project.meta-updated":
      return decodeForEvent(ProjectMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const previousProject = nextBase.projects.find(
            (project) => project.id === payload.projectId,
          );
          const nextWorkbookId =
            payload.workbookId !== undefined
              ? (payload.workbookId ?? null)
              : (previousProject?.workbookId ?? null);
          const nextGroupName =
            payload.groupName !== undefined
              ? payload.groupName
              : (previousProject?.groupName ?? null);
          const nextGroupEmoji =
            payload.groupEmoji !== undefined
              ? payload.groupEmoji
              : (previousProject?.groupEmoji ?? null);

          const nextWorkbooks =
            nextWorkbookId !== null &&
            !currentWorkbooks.some((entry) => entry.id === nextWorkbookId) &&
            nextGroupName !== null
              ? upsertWorkbook(currentWorkbooks, {
                  id: nextWorkbookId,
                  name: nextGroupName,
                  emoji: nextGroupEmoji ?? null,
                  createdAt: previousProject?.createdAt ?? payload.updatedAt,
                  updatedAt: payload.updatedAt,
                  deletedAt: null,
                })
              : [...currentWorkbooks];
          const workbookMetadata = resolveWorkbookMetadata(nextWorkbooks, {
            workbookId: nextWorkbookId,
            groupName: nextGroupName,
            groupEmoji: nextGroupEmoji,
          });

          return {
            ...nextBase,
            workbooks: nextWorkbooks,
            projects: nextBase.projects.map((project) =>
              project.id === payload.projectId
                ? {
                    ...project,
                    ...(payload.title !== undefined ? { title: payload.title } : {}),
                    ...(payload.emoji !== undefined ? { emoji: payload.emoji } : {}),
                    ...(payload.color !== undefined ? { color: payload.color } : {}),
                    ...(payload.workbookId !== undefined ? { workbookId: payload.workbookId } : {}),
                    groupName: nextWorkbookId === null ? nextGroupName : workbookMetadata.groupName,
                    groupEmoji:
                      nextWorkbookId === null ? nextGroupEmoji : workbookMetadata.groupEmoji,
                    ...(payload.workspaceRoot !== undefined
                      ? { workspaceRoot: payload.workspaceRoot }
                      : {}),
                    ...(payload.defaultModel !== undefined
                      ? { defaultModel: payload.defaultModel }
                      : {}),
                    ...(payload.scripts !== undefined ? { scripts: payload.scripts } : {}),
                    updatedAt: payload.updatedAt,
                  }
                : project,
            ),
          };
        }),
      );

    case "project.deleted":
      return decodeForEvent(ProjectDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          projects: nextBase.projects.map((project) =>
            project.id === payload.projectId
              ? {
                  ...project,
                  deletedAt: payload.deletedAt,
                  updatedAt: payload.deletedAt,
                }
              : project,
          ),
        })),
      );

    case "thread.created":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadCreatedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread: OrchestrationThread = yield* decodeForEvent(
          OrchestrationThread,
          {
            id: payload.threadId,
            projectId: payload.projectId,
            title: payload.title,
            model: payload.model,
            runtimeMode: payload.runtimeMode,
            interactionMode: payload.interactionMode,
            branch: payload.branch,
            worktreePath: payload.worktreePath,
            latestTurn: null,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
            deletedAt: null,
            messages: [],
            activities: [],
            checkpoints: [],
            session: null,
          },
          event.type,
          "thread",
        );
        const existing = nextBase.threads.find((entry) => entry.id === thread.id);
        return {
          ...nextBase,
          threads: existing
            ? nextBase.threads.map((entry) => (entry.id === thread.id ? thread : entry))
            : [...nextBase.threads, thread],
        };
      });

    case "thread.deleted":
      return decodeForEvent(ThreadDeletedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            deletedAt: payload.deletedAt,
            updatedAt: payload.deletedAt,
          }),
        })),
      );

    case "thread.meta-updated":
      return decodeForEvent(ThreadMetaUpdatedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(payload.title !== undefined ? { title: payload.title } : {}),
            ...(payload.model !== undefined ? { model: payload.model } : {}),
            ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.worktreePath !== undefined ? { worktreePath: payload.worktreePath } : {}),
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.runtime-mode-set":
      return decodeForEvent(ThreadRuntimeModeSetPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            runtimeMode: payload.runtimeMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.interaction-mode-set":
      return decodeForEvent(
        ThreadInteractionModeSetPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => ({
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            interactionMode: payload.interactionMode,
            updatedAt: payload.updatedAt,
          }),
        })),
      );

    case "thread.message-sent":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          MessageSentPayloadSchema,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const message: OrchestrationMessage = yield* decodeForEvent(
          OrchestrationMessage,
          {
            id: payload.messageId,
            role: payload.role,
            text: payload.text,
            ...(payload.attachments !== undefined ? { attachments: payload.attachments } : {}),
            turnId: payload.turnId,
            streaming: payload.streaming,
            createdAt: payload.createdAt,
            updatedAt: payload.updatedAt,
          },
          event.type,
          "message",
        );

        const existingMessage = thread.messages.find((entry) => entry.id === message.id);
        const messages = existingMessage
          ? thread.messages.map((entry) =>
              entry.id === message.id
                ? {
                    ...entry,
                    text: message.streaming
                      ? `${entry.text}${message.text}`
                      : message.text.length > 0
                        ? message.text
                        : entry.text,
                    streaming: message.streaming,
                    updatedAt: message.updatedAt,
                    turnId: message.turnId,
                    ...(message.attachments !== undefined
                      ? { attachments: message.attachments }
                      : {}),
                  }
                : entry,
            )
          : [...thread.messages, message];
        const cappedMessages = messages.slice(-MAX_THREAD_MESSAGES);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            messages: cappedMessages,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.session-set":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadSessionSetPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const session: OrchestrationSession = yield* decodeForEvent(
          OrchestrationSession,
          payload.session,
          event.type,
          "session",
        );
        const nextSession = {
          ...session,
          canInterrupt: deriveSessionCanInterrupt({
            session,
            latestTurn: thread.latestTurn,
            previousCanInterrupt: session.canInterrupt || (thread.session?.canInterrupt ?? false),
          }),
        } satisfies OrchestrationSession;

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            session: nextSession,
            latestTurn:
              nextSession.status === "running" && nextSession.activeTurnId !== null
                ? {
                    turnId: nextSession.activeTurnId,
                    state: "running",
                    requestedAt:
                      thread.latestTurn?.turnId === nextSession.activeTurnId
                        ? thread.latestTurn.requestedAt
                        : nextSession.updatedAt,
                    startedAt:
                      thread.latestTurn?.turnId === nextSession.activeTurnId
                        ? (thread.latestTurn.startedAt ?? nextSession.updatedAt)
                        : nextSession.updatedAt,
                    completedAt: null,
                    assistantMessageId:
                      thread.latestTurn?.turnId === nextSession.activeTurnId
                        ? thread.latestTurn.assistantMessageId
                        : null,
                  }
                : thread.latestTurn,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-start-requested":
      return decodeForEvent(
        ThreadTurnStartRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (
            !thread?.session ||
            thread.session.status === "stopped" ||
            thread.session.status === "error"
          ) {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              session: {
                ...thread.session,
                canInterrupt: true,
                updatedAt: event.occurredAt,
              },
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.turn-interrupt-requested":
      return decodeForEvent(
        ThreadTurnInterruptRequestedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread?.session) {
            return nextBase;
          }
          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              session: {
                ...thread.session,
                canInterrupt: false,
                updatedAt: event.occurredAt,
              },
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.proposed-plan-upserted":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadProposedPlanUpsertedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const proposedPlans = [
          ...thread.proposedPlans.filter((entry) => entry.id !== payload.proposedPlan.id),
          payload.proposedPlan,
        ]
          .toSorted(
            (left, right) =>
              left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
          )
          .slice(-200);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            proposedPlans,
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.turn-diff-completed":
      return Effect.gen(function* () {
        const payload = yield* decodeForEvent(
          ThreadTurnDiffCompletedPayload,
          event.payload,
          event.type,
          "payload",
        );
        const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
        if (!thread) {
          return nextBase;
        }

        const checkpoint = yield* decodeForEvent(
          OrchestrationCheckpointSummary,
          {
            turnId: payload.turnId,
            checkpointTurnCount: payload.checkpointTurnCount,
            checkpointRef: payload.checkpointRef,
            status: payload.status,
            files: payload.files,
            assistantMessageId: payload.assistantMessageId,
            completedAt: payload.completedAt,
          },
          event.type,
          "checkpoint",
        );

        // Do not let a placeholder (status "missing") overwrite a checkpoint
        // that has already been captured with a real git ref (status "ready").
        // ProviderRuntimeIngestion may fire multiple turn.diff.updated events
        // per turn; without this guard later placeholders would clobber the
        // real capture dispatched by CheckpointReactor.
        const existing = thread.checkpoints.find((entry) => entry.turnId === checkpoint.turnId);
        if (existing && existing.status !== "missing" && checkpoint.status === "missing") {
          return nextBase;
        }

        const checkpoints = [
          ...thread.checkpoints.filter((entry) => entry.turnId !== checkpoint.turnId),
          checkpoint,
        ]
          .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
          .slice(-MAX_THREAD_CHECKPOINTS);

        return {
          ...nextBase,
          threads: updateThread(nextBase.threads, payload.threadId, {
            ...(thread.session
              ? {
                  session: {
                    ...thread.session,
                    canInterrupt: false,
                    updatedAt: event.occurredAt,
                  },
                }
              : {}),
            checkpoints,
            latestTurn: {
              turnId: payload.turnId,
              state: checkpointStatusToLatestTurnState(payload.status),
              requestedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? thread.latestTurn.requestedAt
                  : payload.completedAt,
              startedAt:
                thread.latestTurn?.turnId === payload.turnId
                  ? (thread.latestTurn.startedAt ?? payload.completedAt)
                  : payload.completedAt,
              completedAt: payload.completedAt,
              assistantMessageId: payload.assistantMessageId,
            },
            updatedAt: event.occurredAt,
          }),
        };
      });

    case "thread.reverted":
      return decodeForEvent(ThreadRevertedPayload, event.payload, event.type, "payload").pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const checkpoints = thread.checkpoints
            .filter((entry) => entry.checkpointTurnCount <= payload.turnCount)
            .toSorted((left, right) => left.checkpointTurnCount - right.checkpointTurnCount)
            .slice(-MAX_THREAD_CHECKPOINTS);
          const retainedTurnIds = new Set(checkpoints.map((checkpoint) => checkpoint.turnId));
          const messages = retainThreadMessagesAfterRevert(
            thread.messages,
            retainedTurnIds,
            payload.turnCount,
          ).slice(-MAX_THREAD_MESSAGES);
          const proposedPlans = retainThreadProposedPlansAfterRevert(
            thread.proposedPlans,
            retainedTurnIds,
          ).slice(-200);
          const activities = retainThreadActivitiesAfterRevert(thread.activities, retainedTurnIds);

          const latestCheckpoint = checkpoints.at(-1) ?? null;
          const latestTurn =
            latestCheckpoint === null
              ? null
              : {
                  turnId: latestCheckpoint.turnId,
                  state: checkpointStatusToLatestTurnState(latestCheckpoint.status),
                  requestedAt: latestCheckpoint.completedAt,
                  startedAt: latestCheckpoint.completedAt,
                  completedAt: latestCheckpoint.completedAt,
                  assistantMessageId: latestCheckpoint.assistantMessageId,
                };

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              checkpoints,
              messages,
              proposedPlans,
              activities,
              latestTurn,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    case "thread.activity-appended":
      return decodeForEvent(
        ThreadActivityAppendedPayload,
        event.payload,
        event.type,
        "payload",
      ).pipe(
        Effect.map((payload) => {
          const thread = nextBase.threads.find((entry) => entry.id === payload.threadId);
          if (!thread) {
            return nextBase;
          }

          const activities = [
            ...thread.activities.filter((entry) => entry.id !== payload.activity.id),
            payload.activity,
          ]
            .toSorted(compareThreadActivities)
            .slice(-500);

          return {
            ...nextBase,
            threads: updateThread(nextBase.threads, payload.threadId, {
              activities,
              updatedAt: event.occurredAt,
            }),
          };
        }),
      );

    default:
      return Effect.succeed(nextBase);
  }
}
