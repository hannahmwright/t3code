import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableInfoRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_projects)`;
  const hasProjectColumn = (name: string) => projectColumns.some((column) => column.name === name);

  if (hasProjectColumn("default_model") && hasProjectColumn("default_model_selection_json")) {
    yield* sql`
      UPDATE projection_projects
      SET default_model_selection_json = json_object(
        'provider',
        CASE
          WHEN lower(default_model) LIKE '%claude%' THEN 'claudeAgent'
          ELSE 'codex'
        END,
        'model',
        default_model
      )
      WHERE default_model_selection_json IS NULL
        AND default_model IS NOT NULL
        AND trim(default_model) != ''
    `;
  }

  const threadColumns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_threads)`;
  const hasThreadColumn = (name: string) => threadColumns.some((column) => column.name === name);

  if (hasThreadColumn("model") && hasThreadColumn("model_selection_json")) {
    yield* sql`
      UPDATE projection_threads
      SET model_selection_json = json_object(
        'provider',
        COALESCE(
          (
            SELECT provider_name
            FROM projection_thread_sessions
            WHERE projection_thread_sessions.thread_id = projection_threads.thread_id
          ),
          CASE
            WHEN lower(model) LIKE '%claude%' THEN 'claudeAgent'
            ELSE 'codex'
          END,
          'codex'
        ),
        'model',
        model
      )
      WHERE model_selection_json IS NULL
        AND model IS NOT NULL
        AND trim(model) != ''
    `;
  }

  if (hasThreadColumn("archived_at") && hasThreadColumn("deleted_at")) {
    yield* sql`
      UPDATE projection_threads
      SET deleted_at = archived_at
      WHERE deleted_at IS NULL
        AND archived_at IS NOT NULL
    `;
  }
});
