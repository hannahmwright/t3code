import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableInfoRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_turns)`;
  if (columns.some((column) => column.name === "notification_target_endpoint")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_turns
    ADD COLUMN notification_target_endpoint TEXT
  `;
});
