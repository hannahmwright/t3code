import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info('projection_projects')
  `;
  const columnNames = new Set(columns.map((column) => column.name));

  if (!columnNames.has("color")) {
    yield* sql`
      ALTER TABLE projection_projects
      ADD COLUMN color TEXT
    `;
  }
});
