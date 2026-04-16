import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("024_ProjectionModelColumnsCompatibility", (it) => {
  it.effect(
    "backfills canonical model-selection columns from legacy model columns when present",
    () =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;

        yield* runMigrations({ toMigrationInclusive: 23 });

        yield* sql`ALTER TABLE projection_projects ADD COLUMN default_model TEXT`;
        yield* sql`ALTER TABLE projection_threads ADD COLUMN model TEXT`;

        yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          scripts_json,
          created_at,
          updated_at,
          deleted_at,
          default_model_selection_json,
          default_model
        )
        VALUES (
          'project-1',
          'Project',
          '/tmp/project',
          '[]',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          NULL,
          'claude-opus-4-6'
        )
      `;

        yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          branch,
          worktree_path,
          latest_turn_id,
          created_at,
          updated_at,
          deleted_at,
          runtime_mode,
          interaction_mode,
          archived_at,
          model_selection_json,
          model
        )
        VALUES (
          'thread-1',
          'project-1',
          'Thread',
          NULL,
          NULL,
          NULL,
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          NULL,
          'full-access',
          'default',
          '2026-01-01T01:00:00.000Z',
          NULL,
          'gpt-5-codex'
        )
      `;

        yield* runMigrations({ toMigrationInclusive: 24 });

        const projectRows = yield* sql<{
          readonly defaultModelSelection: string | null;
        }>`
        SELECT default_model_selection_json AS "defaultModelSelection"
        FROM projection_projects
        WHERE project_id = 'project-1'
      `;
        assert.deepStrictEqual(projectRows, [
          {
            defaultModelSelection: '{"provider":"claudeAgent","model":"claude-opus-4-6"}',
          },
        ]);

        const threadRows = yield* sql<{
          readonly modelSelection: string | null;
          readonly deletedAt: string | null;
        }>`
        SELECT
          model_selection_json AS "modelSelection",
          deleted_at AS "deletedAt"
        FROM projection_threads
        WHERE thread_id = 'thread-1'
      `;
        assert.deepStrictEqual(threadRows, [
          {
            modelSelection: '{"provider":"codex","model":"gpt-5-codex"}',
            deletedAt: "2026-01-01T01:00:00.000Z",
          },
        ]);
      }),
  );
});
