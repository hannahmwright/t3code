import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableInfoRow = {
  readonly name: string;
  readonly notnull: number;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_threads)`;
  const projectIdColumn = columns.find((column) => column.name === "project_id");
  if (!projectIdColumn || projectIdColumn.notnull === 0) {
    return;
  }

  yield* sql`DROP TABLE IF EXISTS projection_threads_next`;

  yield* sql`
    CREATE TABLE projection_threads_next (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'gpt-5.1-codex',
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
    INSERT INTO projection_threads_next (
      thread_id,
      project_id,
      title,
      model,
      runtime_mode,
      interaction_mode,
      branch,
      worktree_path,
      latest_turn_id,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT
      thread_id,
      project_id,
      title,
      model,
      COALESCE(runtime_mode, 'full-access'),
      COALESCE(interaction_mode, 'default'),
      branch,
      worktree_path,
      latest_turn_id,
      created_at,
      updated_at,
      deleted_at
    FROM projection_threads
  `;

  yield* sql`DROP TABLE projection_threads`;
  yield* sql`ALTER TABLE projection_threads_next RENAME TO projection_threads`;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_project_id
    ON projection_threads(project_id)
  `;
});
