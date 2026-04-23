import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableInfoRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const projectColumns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_projects)`;
  const hasProjectColumn = (name: string) => projectColumns.some((column) => column.name === name);

  if (!hasProjectColumn("default_model")) {
    yield* sql`ALTER TABLE projection_projects ADD COLUMN default_model TEXT`;
  }

  if (hasProjectColumn("default_model_selection_json")) {
    yield* sql`
      UPDATE projection_projects
      SET default_model = json_extract(default_model_selection_json, '$.model')
      WHERE json_type(default_model_selection_json, '$.model') = 'text'
        AND (default_model IS NULL OR trim(default_model) = '')
    `;
  }

  const threadColumns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_threads)`;
  const hasThreadColumn = (name: string) => threadColumns.some((column) => column.name === name);

  if (!hasThreadColumn("model")) {
    yield* sql`ALTER TABLE projection_threads ADD COLUMN model TEXT`;
  }

  if (hasThreadColumn("model_selection_json")) {
    yield* sql`
      UPDATE projection_threads
      SET model = json_extract(model_selection_json, '$.model')
      WHERE json_type(model_selection_json, '$.model') = 'text'
        AND (model IS NULL OR trim(model) = '')
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
