import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as SqliteClient from "../NodeSqliteClient.ts";
import migration from "./031_ProjectionThreadsNullableProject.ts";

type TableInfoRow = {
  readonly name: string;
  readonly notnull: number;
};

type ThreadRow = {
  readonly thread_id: string;
  readonly project_id: string | null;
  readonly model: string;
  readonly runtime_mode: string;
  readonly interaction_mode: string;
};

const layer = it.layer(SqliteClient.layerMemory());

layer("031_ProjectionThreadsNullableProject", (it) => {
  it.effect("rebuilds projection_threads with a nullable project_id", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        CREATE TABLE projection_threads (
          thread_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          model TEXT NOT NULL,
          runtime_mode TEXT NOT NULL DEFAULT 'full-access',
          interaction_mode TEXT NOT NULL DEFAULT 'default',
          branch TEXT,
          worktree_path TEXT,
          latest_turn_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        )
      `;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread 1',
          'gpt-5.5-codex',
          'read-only',
          'plan',
          '2026-05-04T00:00:00.000Z',
          '2026-05-04T00:00:00.000Z'
        )
      `;

      yield* migration;
      yield* migration;

      const columns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_threads)`;
      const projectIdColumn = columns.find((column) => column.name === "project_id");
      assert.equal(projectIdColumn?.notnull, 0);

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at
        )
        VALUES (
          'thread-2',
          NULL,
          'Loose Thread',
          'gpt-5.5-codex',
          'full-access',
          'default',
          '2026-05-04T00:01:00.000Z',
          '2026-05-04T00:01:00.000Z'
        )
      `;

      const rows = yield* sql<ThreadRow>`
        SELECT thread_id, project_id, model, runtime_mode, interaction_mode
        FROM projection_threads
        ORDER BY thread_id
      `;
      assert.deepEqual(rows, [
        {
          thread_id: "thread-1",
          project_id: "project-1",
          model: "gpt-5.5-codex",
          runtime_mode: "read-only",
          interaction_mode: "plan",
        },
        {
          thread_id: "thread-2",
          project_id: null,
          model: "gpt-5.5-codex",
          runtime_mode: "full-access",
          interaction_mode: "default",
        },
      ]);
    }),
  );
});
