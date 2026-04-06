import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info('projection_projects')
  `;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("emoji")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN emoji TEXT
    `;
  }

  if (!columnNames.has("group_name")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN group_name TEXT
    `;
  }

  if (!columnNames.has("group_emoji")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN group_emoji TEXT
    `;
  }
});
