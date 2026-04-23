import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionWorkbookInput,
  GetProjectionWorkbookInput,
  ProjectionWorkbook,
  ProjectionWorkbookRepository,
  type ProjectionWorkbookRepositoryShape,
} from "../Services/ProjectionWorkbooks.ts";

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionWorkbookRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionWorkbookRow = SqlSchema.void({
    Request: ProjectionWorkbook,
    execute: (row) =>
      sql`
        INSERT INTO projection_workbooks (
          workbook_id,
          name,
          emoji,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.workbookId},
          ${row.name},
          ${row.emoji},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (workbook_id)
        DO UPDATE SET
          name = excluded.name,
          emoji = excluded.emoji,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `,
  });

  const getProjectionWorkbookRow = SqlSchema.findOneOption({
    Request: GetProjectionWorkbookInput,
    Result: ProjectionWorkbook,
    execute: ({ workbookId }) =>
      sql`
        SELECT
          workbook_id AS "workbookId",
          name,
          emoji,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_workbooks
        WHERE workbook_id = ${workbookId}
      `,
  });

  const listProjectionWorkbookRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionWorkbook,
    execute: () =>
      sql`
        SELECT
          workbook_id AS "workbookId",
          name,
          emoji,
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_workbooks
        ORDER BY created_at ASC, workbook_id ASC
      `,
  });

  const deleteProjectionWorkbookRow = SqlSchema.void({
    Request: DeleteProjectionWorkbookInput,
    execute: ({ workbookId }) =>
      sql`
        DELETE FROM projection_workbooks
        WHERE workbook_id = ${workbookId}
      `,
  });

  const upsert: ProjectionWorkbookRepositoryShape["upsert"] = (row) =>
    upsertProjectionWorkbookRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionWorkbookRepository.upsert:query",
          "ProjectionWorkbookRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ProjectionWorkbookRepositoryShape["getById"] = (input) =>
    getProjectionWorkbookRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionWorkbookRepository.getById:query",
          "ProjectionWorkbookRepository.getById:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) =>
            Effect.succeed(Option.some(row as Schema.Schema.Type<typeof ProjectionWorkbook>)),
        }),
      ),
    );

  const listAll: ProjectionWorkbookRepositoryShape["listAll"] = () =>
    listProjectionWorkbookRows().pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionWorkbookRepository.listAll:query",
          "ProjectionWorkbookRepository.listAll:decodeRows",
        ),
      ),
      Effect.map((rows) => rows as ReadonlyArray<Schema.Schema.Type<typeof ProjectionWorkbook>>),
    );

  const deleteById: ProjectionWorkbookRepositoryShape["deleteById"] = (input) =>
    deleteProjectionWorkbookRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionWorkbookRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionWorkbookRepositoryShape;
});

export const ProjectionWorkbookRepositoryLive = Layer.effect(
  ProjectionWorkbookRepository,
  makeProjectionWorkbookRepository,
);
