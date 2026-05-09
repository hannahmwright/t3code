import * as OS from "node:os";

import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const UNASSIGNED_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql<{ readonly count: number }>`
    SELECT COUNT(*) AS count
    FROM projection_threads
    WHERE project_id IS NULL
  `;
  const count = rows[0]?.count ?? 0;

  if (count === 0) {
    return;
  }

  yield* sql`
    INSERT OR IGNORE INTO projection_projects (
      project_id,
      title,
      workspace_root,
      scripts_json,
      default_model_selection_json,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      ${UNASSIGNED_PROJECT_ID},
      'Unassigned',
      ${OS.homedir()},
      '[]',
      NULL,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      NULL
    )
  `;

  yield* sql`
    UPDATE projection_threads
    SET project_id = ${UNASSIGNED_PROJECT_ID}
    WHERE project_id IS NULL
  `;
});
