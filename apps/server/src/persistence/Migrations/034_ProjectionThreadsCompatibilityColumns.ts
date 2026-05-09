import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const hasColumn = (columns: ReadonlyArray<{ readonly name: string }>, name: string): boolean =>
  columns.some((column) => column.name === name);

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_projects)
  `;
  const threadColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!hasColumn(projectColumns, "default_model_selection_json")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN default_model_selection_json TEXT
    `;
  }

  if (hasColumn(projectColumns, "default_model")) {
    yield* sql`
      UPDATE projection_projects
      SET default_model_selection_json = CASE
        WHEN default_model IS NULL THEN NULL
        ELSE json_object(
          'provider',
          CASE
            WHEN lower(default_model) LIKE '%claude%' THEN 'claudeAgent'
            ELSE 'codex'
          END,
          'model',
          default_model
        )
      END
      WHERE default_model_selection_json IS NULL
    `;
  }

  if (!hasColumn(threadColumns, "model_selection_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN model_selection_json TEXT
    `;
  }

  if (hasColumn(threadColumns, "model")) {
    yield* sql`
      UPDATE projection_threads
      SET model_selection_json = json_object(
        'provider',
        CASE
          WHEN lower(COALESCE(model, 'gpt-5.4')) LIKE '%claude%' THEN 'claudeAgent'
          ELSE 'codex'
        END,
        'model',
        COALESCE(NULLIF(model, ''), 'gpt-5.4')
      )
      WHERE model_selection_json IS NULL
         OR model_selection_json = ''
    `;
  } else {
    yield* sql`
      UPDATE projection_threads
      SET model_selection_json = json_object('provider', 'codex', 'model', 'gpt-5.4')
      WHERE model_selection_json IS NULL
         OR model_selection_json = ''
    `;
  }

  if (!hasColumn(threadColumns, "goal_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN goal_json TEXT
    `;
  }

  if (!hasColumn(threadColumns, "archived_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN archived_at TEXT
    `;
  }

  if (!hasColumn(threadColumns, "latest_user_message_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN latest_user_message_at TEXT
    `;
  }

  if (!hasColumn(threadColumns, "pending_approval_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_approval_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!hasColumn(threadColumns, "pending_user_input_count")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pending_user_input_count INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!hasColumn(threadColumns, "has_actionable_proposed_plan")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN has_actionable_proposed_plan INTEGER NOT NULL DEFAULT 0
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_project_archived_at
    ON projection_threads(project_id, archived_at)
  `;
});
