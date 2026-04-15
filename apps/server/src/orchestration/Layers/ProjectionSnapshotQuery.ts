import {
  ChatAttachment,
  EventId,
  IsoDateTime,
  MessageId,
  NonNegativeInt,
  OrchestrationCheckpointFile,
  OrchestrationProposedPlanId,
  OrchestrationReadModel,
  OrchestrationShellReadModel,
  type OrchestrationThreadSnapshot,
  ProjectScript,
  TurnId,
  type OrchestrationCheckpointSummary,
  type OrchestrationLatestTurn,
  type OrchestrationMessage,
  type OrchestrationProposedPlan,
  type OrchestrationProject,
  type OrchestrationSession,
  type OrchestrationThreadActivity,
  ModelSelection,
  OrchestrationThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { Effect, Layer, Option, Schema, Struct } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  isPersistenceError,
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
import { ORCHESTRATION_PROJECTOR_NAMES } from "./ProjectionPipeline.ts";
import {
  ProjectionSnapshotQuery,
  type ProjectionSnapshotCounts,
  type ProjectionThreadCheckpointContext,
  type ProjectionSnapshotQueryShape,
} from "../Services/ProjectionSnapshotQuery.ts";

const decodeReadModel = Schema.decodeUnknownEffect(OrchestrationReadModel);
const decodeShellReadModel = Schema.decodeUnknownEffect(OrchestrationShellReadModel);
const decodeThread = Schema.decodeUnknownEffect(OrchestrationThread);
const ProjectionProjectDbRowSchema = ProjectionProject.mapFields(
  Struct.assign({
    defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
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
const ProjectionThreadDbRowSchema = ProjectionThread.mapFields(
  Struct.assign({
    modelSelection: Schema.fromJsonString(ModelSelection),
  }),
);
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
const ProjectionCountsRowSchema = Schema.Struct({
  projectCount: Schema.Number,
  threadCount: Schema.Number,
});
const ProjectionLatestUserMessageDbRowSchema = Schema.Struct({
  threadId: ThreadId,
  latestUserMessageAt: IsoDateTime,
});
const ProjectionPendingApprovalThreadDbRowSchema = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionUserInputActivityDbRowSchema = Schema.Struct({
  activityId: EventId,
  threadId: ThreadId,
  kind: Schema.String,
  payload: Schema.fromJsonString(Schema.Unknown),
  sequence: Schema.NullOr(NonNegativeInt),
  createdAt: IsoDateTime,
});
const WorkspaceRootLookupInput = Schema.Struct({
  workspaceRoot: Schema.String,
});
const ProjectIdLookupInput = Schema.Struct({
  projectId: ProjectId,
});
const ThreadIdLookupInput = Schema.Struct({
  threadId: ThreadId,
});
const ThreadSnapshotLookupInput = Schema.Struct({
  threadId: ThreadId,
  beforeMessageCreatedAt: Schema.NullOr(IsoDateTime),
  beforeActivityCreatedAt: Schema.NullOr(IsoDateTime),
});
const ThreadCursorLookupInput = Schema.Struct({
  threadId: ThreadId,
  beforeCreatedAt: IsoDateTime,
});
const ProjectionProjectLookupRowSchema = ProjectionProjectDbRowSchema;
const ProjectionThreadIdLookupRowSchema = Schema.Struct({
  threadId: ThreadId,
});
const ProjectionHistoryExistsRowSchema = Schema.Struct({
  rowPresent: Schema.Number,
});
const ProjectionThreadCheckpointContextThreadRowSchema = Schema.Struct({
  threadId: ThreadId,
  projectId: ProjectId,
  workspaceRoot: Schema.String,
  worktreePath: Schema.NullOr(Schema.String),
});

const REQUIRED_SNAPSHOT_PROJECTORS = [
  ORCHESTRATION_PROJECTOR_NAMES.projects,
  ORCHESTRATION_PROJECTOR_NAMES.threads,
  ORCHESTRATION_PROJECTOR_NAMES.threadMessages,
  ORCHESTRATION_PROJECTOR_NAMES.threadProposedPlans,
  ORCHESTRATION_PROJECTOR_NAMES.threadActivities,
  ORCHESTRATION_PROJECTOR_NAMES.threadSessions,
  ORCHESTRATION_PROJECTOR_NAMES.checkpoints,
] as const;

// Keep the initial snapshot lean so the PWA can bootstrap quickly. The client
// can still retain a deeper rolling window from live updates after hydration.
const SNAPSHOT_THREAD_MESSAGE_LIMIT = 2_000;
const SNAPSHOT_THREAD_ACTIVITY_LIMIT = 100;
const THREAD_SNAPSHOT_MESSAGE_LIMIT = 300;
const THREAD_SNAPSHOT_ACTIVITY_LIMIT = 150;

function maxIso(left: string | null, right: string): string {
  if (left === null) {
    return right;
  }
  return left > right ? left : right;
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

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (!normalized) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

function hasStructuredUserInputQuestions(payload: Record<string, unknown> | null): boolean {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return false;
  }

  return questions.some((entry) => {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const question = entry as Record<string, unknown>;
    if (
      typeof question.id !== "string" ||
      typeof question.header !== "string" ||
      typeof question.question !== "string" ||
      !Array.isArray(question.options)
    ) {
      return false;
    }

    return question.options.some((option) => {
      if (!option || typeof option !== "object") {
        return false;
      }
      const optionRecord = option as Record<string, unknown>;
      return (
        typeof optionRecord.label === "string" &&
        typeof optionRecord.description === "string"
      );
    });
  });
}

function buildPendingUserInputThreadIdSet(
  rows: ReadonlyArray<Schema.Schema.Type<typeof ProjectionUserInputActivityDbRowSchema>>,
): ReadonlySet<ThreadId> {
  const openRequestIdsByThread = new Map<ThreadId, Set<string>>();

  for (const row of rows) {
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : null;
    const requestId = payload?.requestId;
    const detail = typeof payload?.detail === "string" ? payload.detail : undefined;

    if (typeof requestId !== "string") {
      continue;
    }

    const openRequestIds = openRequestIdsByThread.get(row.threadId) ?? new Set<string>();

    if (row.kind === "user-input.requested") {
      if (!hasStructuredUserInputQuestions(payload)) {
        continue;
      }
      openRequestIds.add(requestId);
      openRequestIdsByThread.set(row.threadId, openRequestIds);
      continue;
    }

    if (
      row.kind === "user-input.resolved" ||
      (row.kind === "provider.user-input.respond.failed" &&
        isStalePendingRequestFailureDetail(detail))
    ) {
      openRequestIds.delete(requestId);
      if (openRequestIds.size === 0) {
        openRequestIdsByThread.delete(row.threadId);
      }
    }
  }

  return new Set(openRequestIdsByThread.keys());
}

function selectLatestProposedPlan(
  proposedPlans: ReadonlyArray<OrchestrationProposedPlan>,
  latestTurnId: TurnId | null,
): OrchestrationProposedPlan | null {
  const comparePlans = (left: OrchestrationProposedPlan, right: OrchestrationProposedPlan) =>
    left.updatedAt.localeCompare(right.updatedAt) || left.id.localeCompare(right.id);

  if (latestTurnId) {
    const latestTurnPlan = [...proposedPlans]
      .filter((plan) => plan.turnId === latestTurnId)
      .toSorted(comparePlans)
      .at(-1);
    if (latestTurnPlan) {
      return latestTurnPlan;
    }
  }

  return [...proposedPlans].toSorted(comparePlans).at(-1) ?? null;
}

function mapLatestTurn(
  row: Schema.Schema.Type<typeof ProjectionLatestTurnDbRowSchema>,
): OrchestrationLatestTurn {
  return {
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
  };
}

const makeProjectionSnapshotQuery = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const listProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          emoji,
          color,
          group_name AS "groupName",
          group_emoji AS "groupEmoji",
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
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
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
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
        FROM (
          SELECT
            message_id,
            thread_id,
            turn_id,
            role,
            text,
            attachments_json,
            is_streaming,
            created_at,
            updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY created_at DESC, message_id DESC
            ) AS snapshot_rank
          FROM projection_thread_messages
        )
        WHERE snapshot_rank <= ${SNAPSHOT_THREAD_MESSAGE_LIMIT}
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
        FROM (
          SELECT
            activity_id,
            thread_id,
            turn_id,
            tone,
            kind,
            summary,
            payload_json,
            sequence,
            created_at,
            ROW_NUMBER() OVER (
              PARTITION BY thread_id
              ORDER BY
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
                sequence DESC,
                created_at DESC,
                activity_id DESC
            ) AS snapshot_rank
          FROM projection_thread_activities
        )
        WHERE snapshot_rank <= ${SNAPSHOT_THREAD_ACTIVITY_LIMIT}
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

  const listLatestUserMessageRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionLatestUserMessageDbRowSchema,
    execute: () =>
      sql`
        SELECT
          thread_id AS "threadId",
          MAX(created_at) AS "latestUserMessageAt"
        FROM projection_thread_messages
        WHERE role = 'user'
        GROUP BY thread_id
        ORDER BY thread_id ASC
      `,
  });

  const listPendingApprovalThreadRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionPendingApprovalThreadDbRowSchema,
    execute: () =>
      sql`
        SELECT DISTINCT
          thread_id AS "threadId"
        FROM projection_pending_approvals
        WHERE status = 'pending'
        ORDER BY thread_id ASC
      `,
  });

  const listUserInputActivityRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionUserInputActivityDbRowSchema,
    execute: () =>
      sql`
        SELECT
          activity_id AS "activityId",
          thread_id AS "threadId",
          kind,
          payload_json AS "payload",
          sequence,
          created_at AS "createdAt"
        FROM projection_thread_activities
        WHERE kind IN (
          'user-input.requested',
          'user-input.resolved',
          'provider.user-input.respond.failed'
        )
        ORDER BY
          thread_id ASC,
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const readProjectionCounts = SqlSchema.findOne({
    Request: Schema.Void,
    Result: ProjectionCountsRowSchema,
    execute: () =>
      sql`
        SELECT
          (SELECT COUNT(*) FROM projection_projects) AS "projectCount",
          (SELECT COUNT(*) FROM projection_threads) AS "threadCount"
      `,
  });

  const getActiveProjectRowByWorkspaceRoot = SqlSchema.findOneOption({
    Request: WorkspaceRootLookupInput,
    Result: ProjectionProjectLookupRowSchema,
    execute: ({ workspaceRoot }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          emoji,
          color,
          group_name AS "groupName",
          group_emoji AS "groupEmoji",
          workspace_root AS "workspaceRoot",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE workspace_root = ${workspaceRoot}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, project_id ASC
        LIMIT 1
      `,
  });

  const getFirstActiveThreadIdByProject = SqlSchema.findOneOption({
    Request: ProjectIdLookupInput,
    Result: ProjectionThreadIdLookupRowSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          thread_id AS "threadId"
        FROM projection_threads
        WHERE project_id = ${projectId}
          AND deleted_at IS NULL
        ORDER BY created_at ASC, thread_id ASC
        LIMIT 1
      `,
  });

  const getThreadCheckpointContextThreadRow = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadCheckpointContextThreadRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          threads.thread_id AS "threadId",
          threads.project_id AS "projectId",
          projects.workspace_root AS "workspaceRoot",
          threads.worktree_path AS "worktreePath"
        FROM projection_threads AS threads
        INNER JOIN projection_projects AS projects
          ON projects.project_id = threads.project_id
        WHERE threads.thread_id = ${threadId}
          AND threads.deleted_at IS NULL
        LIMIT 1
      `,
  });

  const getThreadRowById = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          project_id AS "projectId",
          title,
          model_selection_json AS "modelSelection",
          runtime_mode AS "runtimeMode",
          interaction_mode AS "interactionMode",
          branch,
          worktree_path AS "worktreePath",
          latest_turn_id AS "latestTurnId",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          archived_at AS "archivedAt",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = ${threadId}
          AND deleted_at IS NULL
        LIMIT 1
      `,
  });

  const listThreadMessageRowsByThread = SqlSchema.findAll({
    Request: ThreadSnapshotLookupInput,
    Result: ProjectionThreadMessageDbRowSchema,
    execute: ({ threadId, beforeMessageCreatedAt }) =>
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
        FROM (
          SELECT
            message_id,
            thread_id,
            turn_id,
            role,
            text,
            attachments_json,
            is_streaming,
            created_at,
            updated_at
          FROM projection_thread_messages
          WHERE thread_id = ${threadId}
            AND (${beforeMessageCreatedAt} IS NULL OR created_at < ${beforeMessageCreatedAt})
          ORDER BY created_at DESC, message_id DESC
          LIMIT ${THREAD_SNAPSHOT_MESSAGE_LIMIT}
        )
        ORDER BY created_at ASC, message_id ASC
      `,
  });

  const listThreadProposedPlanRowsByThread = SqlSchema.findAll({
    Request: ThreadSnapshotLookupInput,
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
        ORDER BY created_at ASC, plan_id ASC
      `,
  });

  const listThreadActivityRowsByThread = SqlSchema.findAll({
    Request: ThreadSnapshotLookupInput,
    Result: ProjectionThreadActivityDbRowSchema,
    execute: ({ threadId, beforeActivityCreatedAt }) =>
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
        FROM (
          SELECT
            activity_id,
            thread_id,
            turn_id,
            tone,
            kind,
            summary,
            payload_json,
            sequence,
            created_at
          FROM projection_thread_activities
          WHERE thread_id = ${threadId}
            AND (${beforeActivityCreatedAt} IS NULL OR created_at < ${beforeActivityCreatedAt})
          ORDER BY
            CASE WHEN sequence IS NULL THEN 0 ELSE 1 END DESC,
            sequence DESC,
            created_at DESC,
            activity_id DESC
          LIMIT ${THREAD_SNAPSHOT_ACTIVITY_LIMIT}
        )
        ORDER BY
          CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
          sequence ASC,
          created_at ASC,
          activity_id ASC
      `,
  });

  const hasOlderMessageRows = SqlSchema.findOneOption({
    Request: ThreadCursorLookupInput,
    Result: ProjectionHistoryExistsRowSchema,
    execute: ({ threadId, beforeCreatedAt }) =>
      sql`
        SELECT 1 AS "rowPresent"
        FROM projection_thread_messages
        WHERE thread_id = ${threadId}
          AND created_at < ${beforeCreatedAt}
        LIMIT 1
      `,
  });

  const hasOlderActivityRows = SqlSchema.findOneOption({
    Request: ThreadCursorLookupInput,
    Result: ProjectionHistoryExistsRowSchema,
    execute: ({ threadId, beforeCreatedAt }) =>
      sql`
        SELECT 1 AS "rowPresent"
        FROM projection_thread_activities
        WHERE thread_id = ${threadId}
          AND created_at < ${beforeCreatedAt}
        LIMIT 1
      `,
  });

  const getThreadSessionRowById = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionThreadSessionDbRowSchema,
    execute: ({ threadId }) =>
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
        WHERE thread_id = ${threadId}
        LIMIT 1
      `,
  });

  const getLatestTurnRowByThread = SqlSchema.findOneOption({
    Request: ThreadIdLookupInput,
    Result: ProjectionLatestTurnDbRowSchema,
    execute: ({ threadId }) =>
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
        WHERE thread_id = ${threadId}
          AND turn_id IS NOT NULL
        ORDER BY requested_at DESC, turn_id DESC
        LIMIT 1
      `,
  });

  const listCheckpointRowsByThread = SqlSchema.findAll({
    Request: ThreadIdLookupInput,
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
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
        ORDER BY checkpoint_turn_count ASC
      `,
  });

  const getSnapshot: ProjectionSnapshotQueryShape["getSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            messageRows,
            proposedPlanRows,
            activityRows,
            sessionRows,
            checkpointRows,
            latestTurnRows,
            stateRows,
          ] = yield* Effect.all([
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
            listThreadMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getSnapshot:listThreadActivities:decodeRows",
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
            listCheckpointRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getSnapshot:listCheckpoints:decodeRows",
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

          let updatedAt: string | null = null;

          for (const row of projectRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of threadRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
          }

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

          for (const row of sessionRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
            sessionsByThread.set(row.threadId, {
              threadId: row.threadId,
              status: row.status,
              providerName: row.providerName,
              runtimeMode: row.runtimeMode,
              activeTurnId: row.activeTurnId,
              lastError: row.lastError,
              updatedAt: row.updatedAt,
            });
          }

          const projects: ReadonlyArray<OrchestrationProject> = projectRows.map((row) => ({
            id: row.projectId,
            title: row.title,
            emoji: row.emoji,
            color: row.color,
            groupName: row.groupName,
            groupEmoji: row.groupEmoji ?? null,
            workspaceRoot: row.workspaceRoot,
            defaultModelSelection: row.defaultModelSelection,
            scripts: row.scripts,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          }));

          const threads: ReadonlyArray<OrchestrationThread> = threadRows.map((row) => ({
            id: row.threadId,
            projectId: row.projectId,
            title: row.title,
            modelSelection: row.modelSelection,
            runtimeMode: row.runtimeMode,
            interactionMode: row.interactionMode,
            branch: row.branch,
            worktreePath: row.worktreePath,
            latestTurn: latestTurnByThread.get(row.threadId) ?? null,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            archivedAt: row.archivedAt,
            deletedAt: row.deletedAt,
            messages: messagesByThread.get(row.threadId) ?? [],
            proposedPlans: proposedPlansByThread.get(row.threadId) ?? [],
            activities: activitiesByThread.get(row.threadId) ?? [],
            checkpoints: checkpointsByThread.get(row.threadId) ?? [],
            session: sessionsByThread.get(row.threadId) ?? null,
          }));

          const snapshot = {
            snapshotSequence: computeSnapshotSequence(stateRows),
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

  const getShellSnapshot: ProjectionSnapshotQueryShape["getShellSnapshot"] = () =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const [
            projectRows,
            threadRows,
            proposedPlanRows,
            sessionRows,
            latestTurnRows,
            latestUserMessageRows,
            pendingApprovalThreadRows,
            userInputActivityRows,
            stateRows,
          ] = yield* Effect.all([
            listProjectRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listProjects:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listProjects:decodeRows",
                ),
              ),
            ),
            listThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listThreads:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listThreads:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadSessionRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listThreadSessions:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listThreadSessions:decodeRows",
                ),
              ),
            ),
            listLatestTurnRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listLatestTurns:decodeRows",
                ),
              ),
            ),
            listLatestUserMessageRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listLatestUserMessages:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listLatestUserMessages:decodeRows",
                ),
              ),
            ),
            listPendingApprovalThreadRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listPendingApprovals:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listPendingApprovals:decodeRows",
                ),
              ),
            ),
            listUserInputActivityRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listUserInputActivities:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listUserInputActivities:decodeRows",
                ),
              ),
            ),
            listProjectionStateRows(undefined).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:query",
                  "ProjectionSnapshotQuery.getShellSnapshot:listProjectionState:decodeRows",
                ),
              ),
            ),
          ]);

          const proposedPlansByThread = new Map<string, Array<OrchestrationProposedPlan>>();
          const sessionsByThread = new Map<string, OrchestrationSession>();
          const latestTurnByThread = new Map<string, OrchestrationLatestTurn>();
          const latestUserMessageAtByThread = new Map<string, string>();
          const pendingApprovalThreadIdSet = new Set(
            pendingApprovalThreadRows.map((row) => row.threadId),
          );
          const pendingUserInputThreadIdSet = buildPendingUserInputThreadIdSet(
            userInputActivityRows,
          );

          let updatedAt: string | null = null;

          for (const row of projectRows) {
            if (row.deletedAt === null) {
              updatedAt = maxIso(updatedAt, row.updatedAt);
            }
          }
          for (const row of threadRows) {
            if (row.deletedAt === null) {
              updatedAt = maxIso(updatedAt, row.updatedAt);
            }
          }
          for (const row of stateRows) {
            updatedAt = maxIso(updatedAt, row.updatedAt);
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

          for (const row of latestUserMessageRows) {
            updatedAt = maxIso(updatedAt, row.latestUserMessageAt);
            latestUserMessageAtByThread.set(row.threadId, row.latestUserMessageAt);
          }

          for (const row of latestTurnRows) {
            updatedAt = maxIso(updatedAt, row.requestedAt);
            if (row.startedAt !== null) {
              updatedAt = maxIso(updatedAt, row.startedAt);
            }
            if (row.completedAt !== null) {
              updatedAt = maxIso(updatedAt, row.completedAt);
            }
            if (!latestTurnByThread.has(row.threadId)) {
              latestTurnByThread.set(row.threadId, mapLatestTurn(row));
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
              lastError: row.lastError,
              updatedAt: row.updatedAt,
            });
          }

          const projects: ReadonlyArray<OrchestrationProject> = projectRows
            .filter((row) => row.deletedAt === null)
            .map((row) => ({
              id: row.projectId,
              title: row.title,
              emoji: row.emoji,
              color: row.color,
              groupName: row.groupName,
              groupEmoji: row.groupEmoji ?? null,
              workspaceRoot: row.workspaceRoot,
              defaultModelSelection: row.defaultModelSelection,
              scripts: row.scripts,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt,
            }));

          const threads = threadRows
            .filter((row) => row.deletedAt === null)
            .map((row) => {
              const latestTurn = latestTurnByThread.get(row.threadId) ?? null;
              const latestProposedPlan = selectLatestProposedPlan(
                proposedPlansByThread.get(row.threadId) ?? [],
                latestTurn?.turnId ?? null,
              );

              return {
                id: row.threadId,
                projectId: row.projectId,
                title: row.title,
                modelSelection: row.modelSelection,
                runtimeMode: row.runtimeMode,
                interactionMode: row.interactionMode,
                branch: row.branch,
                worktreePath: row.worktreePath,
                latestTurn,
                createdAt: row.createdAt,
                updatedAt: row.updatedAt,
                archivedAt: row.archivedAt,
                session: sessionsByThread.get(row.threadId) ?? null,
                latestUserMessageAt: latestUserMessageAtByThread.get(row.threadId) ?? null,
                hasPendingApprovals: pendingApprovalThreadIdSet.has(row.threadId),
                hasPendingUserInput: pendingUserInputThreadIdSet.has(row.threadId),
                hasActionableProposedPlan:
                  latestProposedPlan !== null && latestProposedPlan.implementedAt === null,
              };
            });

          return yield* decodeShellReadModel({
            snapshotSequence: computeSnapshotSequence(stateRows),
            projects,
            threads,
            updatedAt: updatedAt ?? new Date(0).toISOString(),
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError(
                "ProjectionSnapshotQuery.getShellSnapshot:decodeReadModel",
              ),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getShellSnapshot:query")(error);
        }),
      );

  const getThreadSnapshot: ProjectionSnapshotQueryShape["getThreadSnapshot"] = (input) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const { threadId, beforeMessageCreatedAt, beforeActivityCreatedAt } = input;
          const threadRow = yield* getThreadRowById({ threadId }).pipe(
            Effect.mapError(
              toPersistenceSqlOrDecodeError(
                "ProjectionSnapshotQuery.getThreadSnapshot:getThread:query",
                "ProjectionSnapshotQuery.getThreadSnapshot:getThread:decodeRow",
              ),
            ),
          );
          if (Option.isNone(threadRow)) {
            return {
              thread: null,
              hasOlderMessages: false,
              hasOlderActivities: false,
            } satisfies OrchestrationThreadSnapshot;
          }

          const [
            messageRows,
            proposedPlanRows,
            activityRows,
            checkpointRows,
            sessionRow,
            latestTurnRow,
          ] = yield* Effect.all([
            listThreadMessageRowsByThread({
              threadId,
              beforeMessageCreatedAt,
              beforeActivityCreatedAt,
            }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadSnapshot:listThreadMessages:query",
                  "ProjectionSnapshotQuery.getThreadSnapshot:listThreadMessages:decodeRows",
                ),
              ),
            ),
            listThreadProposedPlanRowsByThread({
              threadId,
              beforeMessageCreatedAt,
              beforeActivityCreatedAt,
            }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadSnapshot:listThreadProposedPlans:query",
                  "ProjectionSnapshotQuery.getThreadSnapshot:listThreadProposedPlans:decodeRows",
                ),
              ),
            ),
            listThreadActivityRowsByThread({
              threadId,
              beforeMessageCreatedAt,
              beforeActivityCreatedAt,
            }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadSnapshot:listThreadActivities:query",
                  "ProjectionSnapshotQuery.getThreadSnapshot:listThreadActivities:decodeRows",
                ),
              ),
            ),
            listCheckpointRowsByThread({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadSnapshot:listCheckpoints:query",
                  "ProjectionSnapshotQuery.getThreadSnapshot:listCheckpoints:decodeRows",
                ),
              ),
            ),
            getThreadSessionRowById({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadSnapshot:getThreadSession:query",
                  "ProjectionSnapshotQuery.getThreadSnapshot:getThreadSession:decodeRow",
                ),
              ),
            ),
            getLatestTurnRowByThread({ threadId }).pipe(
              Effect.mapError(
                toPersistenceSqlOrDecodeError(
                  "ProjectionSnapshotQuery.getThreadSnapshot:getLatestTurn:query",
                  "ProjectionSnapshotQuery.getThreadSnapshot:getLatestTurn:decodeRow",
                ),
              ),
            ),
          ]);

          const [hasOlderMessages, hasOlderActivities] = yield* Effect.all([
            Effect.gen(function* () {
              const oldestLoadedMessageAt = messageRows[0]?.createdAt ?? null;
              if (oldestLoadedMessageAt === null) {
                return false;
              }
              return yield* hasOlderMessageRows({
                threadId,
                beforeCreatedAt: oldestLoadedMessageAt,
              }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getThreadSnapshot:hasOlderMessages:query",
                    "ProjectionSnapshotQuery.getThreadSnapshot:hasOlderMessages:decodeRow",
                  ),
                ),
                Effect.map(Option.isSome),
              );
            }),
            Effect.gen(function* () {
              const oldestLoadedActivityAt = activityRows[0]?.createdAt ?? null;
              if (oldestLoadedActivityAt === null) {
                return false;
              }
              return yield* hasOlderActivityRows({
                threadId,
                beforeCreatedAt: oldestLoadedActivityAt,
              }).pipe(
                Effect.mapError(
                  toPersistenceSqlOrDecodeError(
                    "ProjectionSnapshotQuery.getThreadSnapshot:hasOlderActivities:query",
                    "ProjectionSnapshotQuery.getThreadSnapshot:hasOlderActivities:decodeRow",
                  ),
                ),
                Effect.map(Option.isSome),
              );
            }),
          ]);

          const thread = yield* decodeThread({
            id: threadRow.value.threadId,
            projectId: threadRow.value.projectId,
            title: threadRow.value.title,
            modelSelection: threadRow.value.modelSelection,
            runtimeMode: threadRow.value.runtimeMode,
            interactionMode: threadRow.value.interactionMode,
            branch: threadRow.value.branch,
            worktreePath: threadRow.value.worktreePath,
            latestTurn: Option.isSome(latestTurnRow) ? mapLatestTurn(latestTurnRow.value) : null,
            createdAt: threadRow.value.createdAt,
            updatedAt: threadRow.value.updatedAt,
            archivedAt: threadRow.value.archivedAt,
            deletedAt: threadRow.value.deletedAt,
            messages: messageRows.map((row) => ({
              id: row.messageId,
              role: row.role,
              text: row.text,
              ...(row.attachments !== null ? { attachments: row.attachments } : {}),
              turnId: row.turnId,
              streaming: row.isStreaming === 1,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            })),
            proposedPlans: proposedPlanRows.map((row) => ({
              id: row.planId,
              turnId: row.turnId,
              planMarkdown: row.planMarkdown,
              implementedAt: row.implementedAt,
              implementationThreadId: row.implementationThreadId,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
            })),
            activities: activityRows.map((row) => ({
              id: row.activityId,
              tone: row.tone,
              kind: row.kind,
              summary: row.summary,
              payload: row.payload,
              turnId: row.turnId,
              ...(row.sequence !== null ? { sequence: row.sequence } : {}),
              createdAt: row.createdAt,
            })),
            checkpoints: checkpointRows.map((row) => ({
              turnId: row.turnId,
              checkpointTurnCount: row.checkpointTurnCount,
              checkpointRef: row.checkpointRef,
              status: row.status,
              files: row.files,
              assistantMessageId: row.assistantMessageId,
              completedAt: row.completedAt,
            })),
            session: Option.isSome(sessionRow)
              ? {
                  threadId: sessionRow.value.threadId,
                  status: sessionRow.value.status,
                  providerName: sessionRow.value.providerName,
                  runtimeMode: sessionRow.value.runtimeMode,
                  activeTurnId: sessionRow.value.activeTurnId,
                  lastError: sessionRow.value.lastError,
                  updatedAt: sessionRow.value.updatedAt,
                }
              : null,
          }).pipe(
            Effect.mapError(
              toPersistenceDecodeError("ProjectionSnapshotQuery.getThreadSnapshot:decodeThread"),
            ),
          );

          return {
            thread,
            hasOlderMessages,
            hasOlderActivities,
          } satisfies OrchestrationThreadSnapshot;
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          if (isPersistenceError(error)) {
            return error;
          }
          return toPersistenceSqlError("ProjectionSnapshotQuery.getThreadSnapshot:query")(error);
        }),
      );

  const getCounts: ProjectionSnapshotQueryShape["getCounts"] = () =>
    readProjectionCounts(undefined).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionSnapshotQuery.getCounts:query",
          "ProjectionSnapshotQuery.getCounts:decodeRow",
        ),
      ),
      Effect.map(
        (row): ProjectionSnapshotCounts => ({
          projectCount: row.projectCount,
          threadCount: row.threadCount,
        }),
      ),
    );

  const getActiveProjectByWorkspaceRoot: ProjectionSnapshotQueryShape["getActiveProjectByWorkspaceRoot"] =
    (workspaceRoot) =>
      getActiveProjectRowByWorkspaceRoot({ workspaceRoot }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:query",
            "ProjectionSnapshotQuery.getActiveProjectByWorkspaceRoot:decodeRow",
          ),
        ),
        Effect.map(
          Option.map(
            (row): OrchestrationProject => ({
              id: row.projectId,
              title: row.title,
              emoji: row.emoji,
              color: row.color,
              groupName: row.groupName,
              groupEmoji: row.groupEmoji ?? null,
              workspaceRoot: row.workspaceRoot,
              defaultModelSelection: row.defaultModelSelection,
              scripts: row.scripts,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              deletedAt: row.deletedAt,
            }),
          ),
        ),
      );

  const getFirstActiveThreadIdByProjectId: ProjectionSnapshotQueryShape["getFirstActiveThreadIdByProjectId"] =
    (projectId) =>
      getFirstActiveThreadIdByProject({ projectId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:query",
            "ProjectionSnapshotQuery.getFirstActiveThreadIdByProjectId:decodeRow",
          ),
        ),
        Effect.map(Option.map((row) => row.threadId)),
      );

  const getThreadCheckpointContext: ProjectionSnapshotQueryShape["getThreadCheckpointContext"] = (
    threadId,
  ) =>
    Effect.gen(function* () {
      const threadRow = yield* getThreadCheckpointContextThreadRow({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:getThread:decodeRow",
          ),
        ),
      );
      if (Option.isNone(threadRow)) {
        return Option.none<ProjectionThreadCheckpointContext>();
      }

      const checkpointRows = yield* listCheckpointRowsByThread({ threadId }).pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:query",
            "ProjectionSnapshotQuery.getThreadCheckpointContext:listCheckpoints:decodeRows",
          ),
        ),
      );

      return Option.some({
        threadId: threadRow.value.threadId,
        projectId: threadRow.value.projectId,
        workspaceRoot: threadRow.value.workspaceRoot,
        worktreePath: threadRow.value.worktreePath,
        checkpoints: checkpointRows.map(
          (row): OrchestrationCheckpointSummary => ({
            turnId: row.turnId,
            checkpointTurnCount: row.checkpointTurnCount,
            checkpointRef: row.checkpointRef,
            status: row.status,
            files: row.files,
            assistantMessageId: row.assistantMessageId,
            completedAt: row.completedAt,
          }),
        ),
      });
    });

  return {
    getSnapshot,
    getShellSnapshot,
    getThreadSnapshot,
    getCounts,
    getActiveProjectByWorkspaceRoot,
    getFirstActiveThreadIdByProjectId,
    getThreadCheckpointContext,
  } satisfies ProjectionSnapshotQueryShape;
});

export const OrchestrationProjectionSnapshotQueryLive = Layer.effect(
  ProjectionSnapshotQuery,
  makeProjectionSnapshotQuery,
);
