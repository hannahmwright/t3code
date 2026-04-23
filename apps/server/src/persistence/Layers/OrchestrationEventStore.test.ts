import { CommandId, EventId, ProjectId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema, Stream } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { PersistenceDecodeError } from "../Errors.ts";
import { OrchestrationEventStore } from "../Services/OrchestrationEventStore.ts";
import { OrchestrationEventStoreLive } from "./OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "./Sqlite.ts";

const layer = it.layer(
  OrchestrationEventStoreLive.pipe(Layer.provideMerge(SqlitePersistenceMemory)),
);

layer("OrchestrationEventStore", (it) => {
  it.effect("stores json columns as strings and replays decoded events", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      const appended = yield* eventStore.append({
        type: "project.created",
        eventId: EventId.makeUnsafe("evt-store-roundtrip"),
        aggregateKind: "project",
        aggregateId: ProjectId.makeUnsafe("project-roundtrip"),
        occurredAt: now,
        commandId: CommandId.makeUnsafe("cmd-store-roundtrip"),
        causationEventId: null,
        correlationId: CommandId.makeUnsafe("cmd-store-roundtrip"),
        metadata: {
          adapterKey: "codex",
        },
        payload: {
          projectId: ProjectId.makeUnsafe("project-roundtrip"),
          title: "Roundtrip Project",
          workspaceRoot: "/tmp/project-roundtrip",
          defaultModel: null,
          scripts: [],
          createdAt: now,
          updatedAt: now,
        },
      });

      const storedRows = yield* sql<{
        readonly payloadJson: string;
        readonly metadataJson: string;
      }>`
        SELECT
          payload_json AS "payloadJson",
          metadata_json AS "metadataJson"
        FROM orchestration_events
        WHERE event_id = ${appended.eventId}
      `;
      assert.equal(storedRows.length, 1);
      assert.equal(typeof storedRows[0]?.payloadJson, "string");
      assert.equal(typeof storedRows[0]?.metadataJson, "string");

      const replayed = yield* Stream.runCollect(eventStore.readFromSequence(0, 10)).pipe(
        Effect.map((chunk) => Array.from(chunk)),
      );
      assert.equal(replayed.length, 1);
      assert.equal(replayed[0]?.type, "project.created");
      assert.equal(replayed[0]?.metadata.adapterKey, "codex");
    }),
  );

  it.effect("fails with PersistenceDecodeError when stored json is invalid", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.makeUnsafe("evt-store-invalid-json")},
          ${"project"},
          ${ProjectId.makeUnsafe("project-invalid-json")},
          ${0},
          ${"project.created"},
          ${now},
          ${CommandId.makeUnsafe("cmd-store-invalid-json")},
          ${null},
          ${null},
          ${"server"},
          ${"{"},
          ${"{}"}
        )
      `;

      const replayResult = yield* Effect.result(
        Stream.runCollect(eventStore.readFromSequence(0, 10)),
      );
      assert.equal(replayResult._tag, "Failure");
      if (replayResult._tag === "Failure") {
        assert.ok(Schema.is(PersistenceDecodeError)(replayResult.failure));
        assert.ok(
          replayResult.failure.operation.includes(
            "OrchestrationEventStore.readFromSequence:decodeRows",
          ),
        );
      }
    }),
  );

  it.effect("replays legacy model selection event payloads through modern contracts", () =>
    Effect.gen(function* () {
      const eventStore = yield* OrchestrationEventStore;
      const sql = yield* SqlClient.SqlClient;
      const now = new Date().toISOString();
      const startingSequenceRows = yield* sql<{ readonly maxSequence: number | null }>`
        SELECT MAX(sequence) AS "maxSequence"
        FROM orchestration_events
      `;
      const startingSequence = startingSequenceRows[0]?.maxSequence ?? 0;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.makeUnsafe("evt-legacy-project-created")},
          ${"project"},
          ${ProjectId.makeUnsafe("project-legacy")},
          ${0},
          ${"project.created"},
          ${now},
          ${null},
          ${null},
          ${null},
          ${"server"},
          ${JSON.stringify({
            projectId: "project-legacy",
            title: "Legacy Project",
            workspaceRoot: "/tmp/project-legacy",
            defaultModelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
            createdAt: now,
            updatedAt: now,
          })},
          ${"{}"}
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.makeUnsafe("evt-legacy-thread-created")},
          ${"thread"},
          ${"thread-legacy"},
          ${0},
          ${"thread.created"},
          ${now},
          ${null},
          ${null},
          ${null},
          ${"server"},
          ${JSON.stringify({
            threadId: "thread-legacy",
            projectId: "project-legacy",
            title: "Legacy Thread",
            modelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: now,
            updatedAt: now,
          })},
          ${"{}"}
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.makeUnsafe("evt-legacy-thread-turn-start")},
          ${"thread"},
          ${"thread-legacy"},
          ${1},
          ${"thread.turn-start-requested"},
          ${now},
          ${null},
          ${null},
          ${null},
          ${"server"},
          ${JSON.stringify({
            threadId: "thread-legacy",
            messageId: "message-legacy",
            assistantDeliveryMode: "streaming",
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: now,
            modelSelection: {
              provider: "claudeAgent",
              model: "claude-opus-4-6",
              options: {
                claudeAgent: {
                  effort: "high",
                },
              },
            },
          })},
          ${"{}"}
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.makeUnsafe("evt-legacy-thread-meta-updated")},
          ${"thread"},
          ${"thread-legacy"},
          ${2},
          ${"thread.meta-updated"},
          ${now},
          ${null},
          ${null},
          ${null},
          ${"server"},
          ${JSON.stringify({
            threadId: "thread-legacy",
            updatedAt: now,
            modelSelection: {
              provider: "codex",
              model: "gpt-5.4",
            },
          })},
          ${"{}"}
        )
      `;

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          ${EventId.makeUnsafe("evt-legacy-thread-archived")},
          ${"thread"},
          ${"thread-legacy"},
          ${3},
          ${"thread.archived"},
          ${now},
          ${null},
          ${null},
          ${null},
          ${"server"},
          ${JSON.stringify({
            threadId: "thread-legacy",
            archivedAt: now,
            updatedAt: now,
          })},
          ${"{}"}
        )
      `;

      const replayed = yield* Stream.runCollect(
        eventStore.readFromSequence(startingSequence, 10),
      ).pipe(Effect.map((chunk) => Array.from(chunk)));

      assert.equal(replayed.length, 5);
      assert.equal(replayed[0]?.type, "project.created");
      if (replayed[0]?.type === "project.created") {
        assert.equal(replayed[0].payload.defaultModel, "gpt-5.4");
        assert.deepEqual(replayed[0].payload.scripts, []);
      }

      assert.equal(replayed[1]?.type, "thread.created");
      if (replayed[1]?.type === "thread.created") {
        assert.equal(replayed[1].payload.model, "claude-opus-4-6");
        assert.equal(replayed[1].payload.branch, null);
        assert.equal(replayed[1].payload.worktreePath, null);
      }

      assert.equal(replayed[2]?.type, "thread.turn-start-requested");
      if (replayed[2]?.type === "thread.turn-start-requested") {
        assert.equal(replayed[2].payload.provider, "claudeAgent");
        assert.equal(replayed[2].payload.model, "claude-opus-4-6");
        assert.deepEqual(replayed[2].payload.modelOptions, {
          claudeAgent: {
            effort: "high",
          },
        });
      }

      assert.equal(replayed[3]?.type, "thread.meta-updated");
      if (replayed[3]?.type === "thread.meta-updated") {
        assert.equal(replayed[3].payload.model, "gpt-5.4");
      }

      assert.equal(replayed[4]?.type, "thread.deleted");
      if (replayed[4]?.type === "thread.deleted") {
        assert.equal(replayed[4].payload.deletedAt, now);
      }
    }),
  );
});
