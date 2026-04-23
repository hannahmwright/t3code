import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_workbooks (
      workbook_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      emoji TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )
  `;

  const projectColumns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info('projection_projects')
  `;
  const projectColumnNames = new Set(projectColumns.map((column) => column.name));

  if (!projectColumnNames.has("workbook_id")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN workbook_id TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_workbooks_updated_at
    ON projection_workbooks(updated_at)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_projects_workbook_id
    ON projection_projects(workbook_id)
  `;

  yield* sql`
    INSERT INTO projection_workbooks (
      workbook_id,
      name,
      emoji,
      created_at,
      updated_at,
      deleted_at
    )
    SELECT
      'legacy:' || lower(trim(group_name)) AS workbook_id,
      trim(group_name) AS name,
      MAX(CASE WHEN group_emoji IS NOT NULL AND trim(group_emoji) <> '' THEN trim(group_emoji) END) AS emoji,
      MIN(created_at) AS created_at,
      MAX(updated_at) AS updated_at,
      NULL AS deleted_at
    FROM projection_projects
    WHERE group_name IS NOT NULL AND trim(group_name) <> ''
    GROUP BY lower(trim(group_name))
    ON CONFLICT (workbook_id)
    DO UPDATE SET
      name = excluded.name,
      emoji = COALESCE(excluded.emoji, projection_workbooks.emoji),
      updated_at = CASE
        WHEN projection_workbooks.updated_at > excluded.updated_at
          THEN projection_workbooks.updated_at
        ELSE excluded.updated_at
      END
  `;

  yield* sql`
    UPDATE projection_projects
    SET workbook_id = 'legacy:' || lower(trim(group_name))
    WHERE workbook_id IS NULL AND group_name IS NOT NULL AND trim(group_name) <> ''
  `;
});
