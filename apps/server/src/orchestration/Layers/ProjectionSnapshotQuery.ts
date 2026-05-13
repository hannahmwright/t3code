import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  ChatAttachment,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  ProviderInteractionMode,
  ProjectScript,
  RuntimeMode,
  ThreadGoalSnapshot,
  ThreadId,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationSession,
  type OrchestrationSnapshotDetailMode,
  type OrchestrationThread,
  type OrchestrationThreadActivity,
  type OrchestrationWorkbook,
} from "@t3tools/contracts";
import { Effect, Layer, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
  toPersistenceDecodeCauseError,
  toPersistenceDecodeError,
  toPersistenceSqlError,
  type ProjectionRepositoryError,
} from "../../persistence/Errors.ts";
import { ProjectionCheckpoint } from "../../persistence/Services/ProjectionCheckpoints.ts";
import { ProjectionProject } from "../../persistence/Services/ProjectionProjects.ts";
import { ProjectionState } from "../../persistence/Services/ProjectionState.ts";
import { ProjectionThreadActivity } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlan } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionThreadSession } from "../../persistence/Services/ProjectionThreadSessions.ts";
import { ProjectionThread } from "../../persistence/Services/ProjectionThreads.ts";
import { ProjectionPendingTurnStart } from "../../persistence/Services/ProjectionTurns.ts";
import { ProjectionWorkbook } from "../../persistence/Services/ProjectionWorkbooks.ts";
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    setAside: Schema.Number,
    scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  }),
);
const ProjectionThreadMessageDbRowSchema = ProjectionThreadMessage.mapFields(
  Struct.assign({
    isStreaming: Schema.Number,
    attachments: Schema.NullOr(Schema.fromJsonString(Schema.Array(ChatAttachment))),
  }),
);
const ProjectionThreadProposedPlanDbRowSchema = ProjectionThreadProposedPlan;
export const ProjectionThreadDbRowSchema = Schema.Struct({
  ...ProjectionThread.fields,
  model: Schema.NullOr(Schema.String),
  runtimeMode: Schema.NullOr(RuntimeMode),
  interactionMode: Schema.NullOr(ProviderInteractionMode),
  goal: Schema.NullOr(Schema.fromJsonString(ThreadGoalSnapshot)),
});
type ProjectionThreadDbRow = Schema.Schema.Type<typeof ProjectionThreadDbRowSchema>;

export function normalizeProjectionThreadRow(row: ProjectionThreadDbRow) {
  return {
    ...row,
    model: row.model ?? DEFAULT_MODEL_BY_PROVIDER.codex,
    runtimeMode: row.runtimeMode ?? DEFAULT_RUNTIME_MODE,
    interactionMode: row.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE,
  };
}
const ProjectionThreadActivityDbRowSchema = ProjectionThreadActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);
const ProjectionThreadSessionDbRowSchema = ProjectionThreadSession;
const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
  }),
);
const ProjectionLatestTurnDbRowSchema = Schema.Struct({
  threadId: ProjectionThread.fields.threadId,
  turnId: TurnId,
  state: Schema.String,
  requestedAt: IsoDateTime,
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
  assistantMessageId: Schema.NullOr(MessageId),
  sourceProposedPlanThreadId: Schema.NullOr(ThreadId),
  sourceProposedPlanId: Schema.NullOr(OrchestrationProposedPlanId),
});
const ProjectionStateDbRowSchema = ProjectionState;

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.workbooks,
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
] as const;

const ACTIVE_SNAPSHOT_RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const HYDRATE_THREAD_QUERY_CONCURRENCY = 8;

const ThreadSnapshotRequest = Schema.Struct({
  threadId: ThreadId,
});

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
}

function deriveSessionCanInterrupt(input: {
  status: OrchestrationSession["status"];
  activeTurnId: OrchestrationSession["activeTurnId"];
  latestTurn: OrchestrationLatestTurn | undefined;
  hasPendingTurnStart: boolean;
}): boolean {
  switch (input.status) {
    case "running":
      return input.activeTurnId !== null || input.latestTurn?.completedAt === null;
    case "starting":
    case "ready":
      return input.hasPendingTurnStart;
    default:
      return false;
  }
}

function isRuntimeActiveSession(status: OrchestrationSession["status"]): boolean {
  return status === "starting" || status === "running";
}

function shouldHydrateThreadDetails(input: {
  detailMode: OrchestrationSnapshotDetailMode;
  row: ProjectionThreadDbRow;
  session: OrchestrationSession | undefined;
  latestTurn: OrchestrationLatestTurn | undefined;
  recentSince: string;
  forcedThreadIds: ReadonlySet<string>;
}): boolean {
  if (input.detailMode === "full") {
    return true;
  }
  if (input.forcedThreadIds.has(input.row.threadId)) {
    return true;
  }
  if (input.row.updatedAt >= input.recentSince) {
    return true;
  }
  if (input.session !== undefined && isRuntimeActiveSession(input.session.status)) {
    return true;
  }
  return input.latestTurn?.completedAt === null;
}

function computeSnapshotSequence(
  stateRows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionStateDbRowSchema>>,
): number {
  if (stateRows.length === 0) {
    return 0;
  }
  const sequenceByProjector = new Map(
    stateRows.map((row) => [row.projector, row.lastAppliedSequence] as const),
  );

  let minSequence = Number.POSITIVE_INFINITY;
  for (const projector of REQUIRED_SNAPSHOT_PROJECTORS) {
    const sequence = sequenceByProjector.get(projector);
    if (sequence === undefined) {
      return 0;
    }
    if (sequence < minSequence) {
      minSequence = sequence;
    }
  }

  return Number.isFinite(minSequence) ? minSequence : 0;
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown): ProjectionRepositoryError =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listWorkbookRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionWorkbook,
    execute: () =>
      sql`
        SELECT
          workbook_id AS "workbookId",
          name,
          emoji,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_workbooks
        ORDER BY created_at ASC, workbook_id ASC
      `,
  });

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          projection_projects.title AS "title",
          projection_projects.emoji AS "emoji",
          projection_projects.color AS "color",
          projection_projects.set_aside AS "setAside",
          projection_projects.workbook_id AS "workbookId",
          COALESCE(projection_workbooks.name, projection_projects.group_name) AS "groupName",
          COALESCE(projection_workbooks.emoji, projection_projects.group_emoji) AS "groupEmoji",
          projection_projects.workspace_root AS "workspaceRoot",
          projection_projects.default_model AS "defaultModel",
          projection_projects.scripts_json AS "scripts",
          projection_projects.created_at AS "createdAt",
          projection_projects.updated_at AS "updatedAt",
          projection_projects.deleted_at AS "deletedAt"
        FROM projection_projects
        LEFT JOIN projection_workbooks
          ON projection_workbooks.workbook_id = projection_projects.workbook_id
        ORDER BY projection_projects.created_at ASC, projection_projects.project_id ASC
      `,
  });

  const listThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          sidechat_source_thread_id AS "sidechatSourceThreadId",
          title,
          model,
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          goal_json AS "goal",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        ORDER BY created_at ASC, thread_id ASC
      `,
  });

  const listThreadMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `,
  });

  const listThreadMessageRowsByThreadId = SqlSchema.findAll({
    Request: ThreadSnapshotRequest,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          message_id AS "messageId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          role,
          text,
          attachments_json AS "attachments",
          is_streaming AS "isStreaming",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
        ORDER BY thread_id ASC, created_at ASC, message_id ASC
      `,
  });

  const listThreadProposedPlanRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: () =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `,
  });

  const listThreadProposedPlanRowsByThreadId = SqlSchema.findAll({
    Request: ThreadSnapshotRequest,
    Result: ProjectionThreadProposedPlanDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          plan_id AS "planId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          plan_markdown AS "planMarkdown",
          implemented_at AS "implementedAt",
          implementation_thread_id AS "implementationThreadId",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM projection_thread_proposed_plans
        WHERE thread_id = ${threadId}
        ORDER BY thread_id ASC, created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listThreadActivityRowsByThreadId = SqlSchema.findAll({
    Request: ThreadSnapshotRequest,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          turn_id AS "turnId",
          tone,
          kind,
          summary,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const listThreadSessionRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          status,
          provider_name AS "providerName",
          provider_session_id AS "providerSessionId",
          provider_thread_id AS "providerThreadId",
          runtime_mode AS "runtimeMode",
          active_turn_id AS "activeTurnId",
          last_error AS "lastError",
          updated_at AS "updatedAt"
        FROM projection_thread_sessions
        ORDER BY thread_id ASC
      `,
  });

  const listCheckpointRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionCheckpointDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE checkpoint_turn_count IS NOT NULL
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listCheckpointRowsByThreadId = SqlSchema.findAll({
    Request: ThreadSnapshotRequest,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt"
        FROM projection_turns
        WHERE checkpoint_turn_count IS NOT NULL
          AND thread_id = ${threadId}
        ORDER BY thread_id ASC, checkpoint_turn_count ASC
      `,
  });

  const listLatestTurnRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          assistant_message_id AS "assistantMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId"
        FROM projection_turns
        WHERE turn_id IS NOT NULL
        ORDER BY thread_id ASC, requested_at DESC, turn_id DESC
      `,
  });

  const listPendingTurnStartRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionPendingTurnStart,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          pending_message_id AS "messageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          notification_target_endpoint AS "notificationTargetEndpoint",
          requested_at AS "requestedAt"
        FROM projection_turns
        WHERE turn_id IS NULL
        ORDER BY thread_id ASC, requested_at DESC
      `,
  });

  const listProjectionStateRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionStateDbRowSchema,
    execute: () =>
      sql`
        SELECT
          projector,
          last_applied_sequence AS "lastAppliedSequence",
          updated_at AS "updatedAt"
        FROM projection_state
      `,
  });

  const listMessageRowsForThreadIds = (threadIds: ReadonlyArray<ThreadId>) =>
    Effect.forEach(threadIds, (threadId) => listThreadMessageRowsByThreadId({ threadId }), {
      concurrency: HYDRATE_THREAD_QUERY_CONCURRENCY,
    }).pipe(Effect.map((rows) => rows.flat()));

  const listProposedPlanRowsForThreadIds = (threadIds: ReadonlyArray<ThreadId>) =>
    Effect.forEach(threadIds, (threadId) => listThreadProposedPlanRowsByThreadId({ threadId }), {
      concurrency: HYDRATE_THREAD_QUERY_CONCURRENCY,
    }).pipe(Effect.map((rows) => rows.flat()));

  const listActivityRowsForThreadIds = (threadIds: ReadonlyArray<ThreadId>) =>
    Effect.forEach(threadIds, (threadId) => listThreadActivityRowsByThreadId({ threadId }), {
      concurrency: HYDRATE_THREAD_QUERY_CONCURRENCY,
    }).pipe(Effect.map((rows) => rows.flat()));

  const listCheckpointRowsForThreadIds = (threadIds: ReadonlyArray<ThreadId>) =>
    Effect.forEach(threadIds, (threadId) => listCheckpointRowsByThreadId({ threadId }), {
      concurrency: HYDRATE_THREAD_QUERY_CONCURRENCY,
    }).pipe(Effect.map((rows) => rows.flat()));

  const buildSnapshot = (options: {
    readonly detailMode: OrchestrationSnapshotDetailMode;
    readonly forcedThreadIds?: ReadonlySet<string>;
    readonly onlyThreadId?: ThreadId;
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            workbookRows,
            projectRows,
            threadRows,
            sessionRows,
            latestTurnRows,
            pendingTurnStartRows,
            stateRows,
          ] = yield* Effect.all([
            listWorkbookRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listWorkbooks:query",
                  "ProjectionSnapshotQuery.getSnapshot:listWorkbooks:decodeRows",
                ),
              ),
            ),
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjects:decodeRows",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreads:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listPendingTurnStartRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listPendingTurnStarts:query",
                  "ProjectionSnapshotQuery.getSnapshot:listPendingTurnStarts:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const messagesByThread = new Map<string, Array<OrchestrationMessage>>();
          const proposedPlansByThread = new Map<string, Array<OrchestrationProposedPlan>>();
          const activitiesByThread = new Map<string, Array<OrchestrationThreadActivity>>();
          const checkpointsByThread = new Map<string, Array<OrchestrationCheckpointSummary>>();
          const sessionsByThread = new Map<string, OrchestrationSession>();
          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();
          const pendingTurnStartsByThread = new Map<
            string,
            Schema.Schema.Type<typeof ProjectionPendingTurnStart>
          >();

          let updatedAt: string | null = null;

          for (const row of workbookRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

          for (const row of latestTurnRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) {
              updatedAt = maxIso(updatedAt, row.startedAt);
            }
            if (row.completedAt !== null) {
              updatedAt = maxIso(updatedAt, row.completedAt);
            }
            if (latestTurnByThread.has(row.threadId)) {
              continue;
            }
            latestTurnByThread.set(row.threadId, {
              turnId: row.turnId,
              state:
                row.state === "error"
                  ? "error"
                  : row.state === "interrupted"
                    ? "interrupted"
                    : row.state === "completed"
                      ? "completed"
                      : "running",
              requestedAt: row.requestedAt,
              startedAt: row.startedAt,
              completedAt: row.completedAt,
              assistantMessageId: row.assistantMessageId,
              ...(row.sourceProposedPlanThreadId !== null && row.sourceProposedPlanId !== null
                ? {
                    sourceProposedPlan: {
                      threadId: row.sourceProposedPlanThreadId,
                      planId: row.sourceProposedPlanId,
                    },
                  }
                : {}),
            });
          }

          for (const row of pendingTurnStartRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (!pendingTurnStartsByThread.has(row.threadId)) {
              pendingTurnStartsByThread.set(row.threadId, row);
            }
          }

          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            sessionsByThread.set(row.threadId, {
              threadId: row.threadId,
              status: row.status,
              providerName: row.providerName,
              runtimeMode: row.runtimeMode,
              activeTurnId: row.activeTurnId,
              canInterrupt: deriveSessionCanInterrupt({
                status: row.status,
                activeTurnId: row.activeTurnId,
                latestTurn: latestTurnByThread.get(row.threadId),
                hasPendingTurnStart: pendingTurnStartsByThread.has(row.threadId),
              }),
              lastError: row.lastError,
              updatedAt: row.updatedAt,
            });
          }

          const forcedThreadIds = options.forcedThreadIds ?? new Set<string>();
          const recentSince = new Date(Date.now() - ACTIVE_SNAPSHOT_RECENT_WINDOW_MS).toISOString();
          const snapshotThreadRows =
            options.onlyThreadId === undefined
              ? threadRows
              : threadRows.filter((row) => row.threadId === options.onlyThreadId);
          const hydratedThreadIds = snapshotThreadRows
            .filter((row) =>
              shouldHydrateThreadDetails({
                detailMode: options.detailMode,
                row,
                session: sessionsByThread.get(row.threadId),
                latestTurn: latestTurnByThread.get(row.threadId),
                recentSince,
                forcedThreadIds,
              }),
            )
            .map((row) => row.threadId);

          const shouldUseFullTableScan =
            options.detailMode === "full" && options.onlyThreadId === undefined;
          const [messageRows, proposedPlanRows, activityRows, checkpointRows] =
            hydratedThreadIds.length === 0
              ? [[], [], [], []]
              : yield* Effect.all([
                  (shouldUseFullTableScan
                    ? listThreadMessageRows(undefined)
                    : listMessageRowsForThreadIds(hydratedThreadIds)
                  ).pipe(
                    Effect.mapError(
                      toPersistenceSqlOrDecodeError(
                        "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                        "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                      ),
                    ),
                  ),
                  (shouldUseFullTableScan
                    ? listThreadProposedPlanRows(undefined)
                    : listProposedPlanRowsForThreadIds(hydratedThreadIds)
                  ).pipe(
                    Effect.mapError(
                      toPersistenceSqlOrDecodeError(
                        "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                        "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                      ),
                    ),
                  ),
                  (shouldUseFullTableScan
                    ? listThreadActivityRows(undefined)
                    : listActivityRowsForThreadIds(hydratedThreadIds)
                  ).pipe(
                    Effect.mapError(
                      toPersistenceSqlOrDecodeError(
                        "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                        "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
                      ),
                    ),
                  ),
                  (shouldUseFullTableScan
                    ? listCheckpointRows(undefined)
                    : listCheckpointRowsForThreadIds(hydratedThreadIds)
                  ).pipe(
                    Effect.mapError(
                      toPersistenceSqlOrDecodeError(
                        "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                        "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
                      ),
                    ),
                  ),
                ]);

          for (const row of messageRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadMessages = messagesByThread.get(row.threadId) ?? [];
            threadMessages.push({
              id: row.messageId,
              role: row.role,
              text: row.text,
              ...(row.attachments !== null ? { attachments: row.attachments } : {}),
              turnId: row.turnId,
              streaming: row.isStreaming === 1,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            messagesByThread.set(row.threadId, threadMessages);
          }

          for (const row of proposedPlanRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            const threadProposedPlans = proposedPlansByThread.get(row.threadId) ?? [];
            threadProposedPlans.push({
              id: row.planId,
              turnId: row.turnId,
              planMarkdown: row.planMarkdown,
              implementedAt: row.implementedAt,
              implementationThreadId: row.implementationThreadId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            });
            proposedPlansByThread.set(row.threadId, threadProposedPlans);
          }

          for (const row of activityRows) {
            updatedAt = maxIso(updatedAt, row.createdAt);
            const threadActivities = activitiesByThread.get(row.threadId) ?? [];
            threadActivities.push({
              id: row.activityId,
              tone: row.tone,
              kind: row.kind,
              summary: row.summary,
              payload: row.payload,
              turnId: row.turnId,
              ...(row.sequence !== null ? { sequence: row.sequence } : {}),
              createdAt: row.createdAt,
            });
            activitiesByThread.set(row.threadId, threadActivities);
          }

          for (const row of checkpointRows) {
            updatedAt = maxIso(updatedAt, row.completedAt);
            const threadCheckpoints = checkpointsByThread.get(row.threadId) ?? [];
            threadCheckpoints.push({
              turnId: row.turnId,
              checkpointTurnCount: row.checkpointTurnCount,
              checkpointRef: row.checkpointRef,
              status: row.status,
              files: row.files,
              assistantMessageId: row.assistantMessageId,
              completedAt: row.completedAt,
            });
            checkpointsByThread.set(row.threadId, threadCheckpoints);
          }

          const workbooks: Array<OrchestrationWorkbook> = workbookRows.map((row) => ({
            id: row.workbookId,
            name: row.name,
            emoji: row.emoji,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }));

          const projects: Array<OrchestrationProject> = projectRows.map((row) => ({
            id: row.projectId,
            title: row.title,
            emoji: row.emoji,
            color: row.color,
            setAside: row.setAside === 1,
            workbookId: row.workbookId,
            groupName: row.groupName,
            groupEmoji: row.groupEmoji,
            workspaceRoot: row.workspaceRoot,
            defaultModel: row.defaultModel,
            scripts: row.scripts,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }));

          const hydratedThreadIdSet = new Set(hydratedThreadIds);
          const threads: Array<OrchestrationThread> = snapshotThreadRows.map((row) => {
            const normalizedRow = normalizeProjectionThreadRow(row);
            return {
              id: normalizedRow.threadId,
              projectId: normalizedRow.projectId,
              sidechatSourceThreadId: normalizedRow.sidechatSourceThreadId ?? null,
              title: normalizedRow.title,
              model: normalizedRow.model,
              runtimeMode: normalizedRow.runtimeMode,
              interactionMode: normalizedRow.interactionMode,
              branch: normalizedRow.branch,
              worktreePath: normalizedRow.worktreePath,
              latestTurn: latestTurnByThread.get(normalizedRow.threadId) ?? null,
              createdAt: normalizedRow.createdAt,
              updatedAt: normalizedRow.updatedAt,
              deletedAt: normalizedRow.deletedAt,
              messages: messagesByThread.get(normalizedRow.threadId) ?? [],
              proposedPlans: proposedPlansByThread.get(normalizedRow.threadId) ?? [],
              activities: activitiesByThread.get(normalizedRow.threadId) ?? [],
              checkpoints: checkpointsByThread.get(normalizedRow.threadId) ?? [],
              session: sessionsByThread.get(normalizedRow.threadId) ?? null,
              detailsLoaded: hydratedThreadIdSet.has(normalizedRow.threadId),
            };
          });

          const snapshot = {
            snapshotSequence: computeSnapshotSequence(stateRows),
            workbooks,
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          };

          return yield* decodeReadModel(snapshot).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getSnapshot:decodeReadModel"),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getSnapshot:query")(error);
        }),
      );

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = (input) =>
    buildSnapshot({ detailMode: input?.detailMode ?? "full" });

  const getThreadSnapshot: ProjectionSnapshotQueryShape["getThreadSnapshot"] = (threadId) =>
    buildSnapshot({
      detailMode: "full",
      forcedThreadIds: new Set([threadId]),
      onlyThreadId: threadId,
    }).pipe(
      Effect.flatMap((snapshot) => {
        const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
        if (!thread) {
          return Effect.fail(
            toPersistenceDecodeCauseError("ProjectionSnapshotQuery.getThreadSnapshot:notFound")(
              new Error(`Thread ${threadId} not found in projection snapshot`),
            ),
          );
        }
        return Effect.succeed({ thread });
      }),
    );

  return {
    getSnapshot,
    getThreadSnapshot,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
