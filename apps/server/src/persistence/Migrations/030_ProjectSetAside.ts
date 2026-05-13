import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info('projection_projects')
  `;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("set_aside")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN set_aside INTEGER NOT NULL DEFAULT 0
    `;
  }

  yield* sql`
    UPDATE projection_projects
    SET set_aside = 0
    WHERE set_aside IS NULL
  `;
});
