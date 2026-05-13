import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

type TableInfoRow = {
  readonly name: string;
};

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<TableInfoRow>`PRAGMA table_info(projection_threads)`;
  if (columns.some((column) => column.name === "sidechat_source_thread_id")) {
    return;
  }

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN sidechat_source_thread_id TEXT
  `;
});
