import { IsoDateTime, WorkbookId } from "@t3tools/contracts";
import { Option, Schema, ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProjectionRepositoryError } from "../Errors.ts";

export const ProjectionWorkbook = Schema.Struct({
  workbookId: WorkbookId,
  name: Schema.String,
  emoji: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(() => null)),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  deletedAt: Schema.NullOr(IsoDateTime).pipe(Schema.withDecodingDefault(() => null)),
});
export type ProjectionWorkbook = typeof ProjectionWorkbook.Type;

export const GetProjectionWorkbookInput = Schema.Struct({
  workbookId: WorkbookId,
});
export type GetProjectionWorkbookInput = typeof GetProjectionWorkbookInput.Type;

export const DeleteProjectionWorkbookInput = Schema.Struct({
  workbookId: WorkbookId,
});
export type DeleteProjectionWorkbookInput = typeof DeleteProjectionWorkbookInput.Type;

export interface ProjectionWorkbookRepositoryShape {
  readonly upsert: (row: ProjectionWorkbook) => Effect.Effect<void, ProjectionRepositoryError>;
  readonly getById: (
    input: GetProjectionWorkbookInput,
  ) => Effect.Effect<Option.Option<ProjectionWorkbook>, ProjectionRepositoryError>;
  readonly listAll: () => Effect.Effect<
    ReadonlyArray<ProjectionWorkbook>,
    ProjectionRepositoryError
  >;
  readonly deleteById: (
    input: DeleteProjectionWorkbookInput,
  ) => Effect.Effect<void, ProjectionRepositoryError>;
}

export class ProjectionWorkbookRepository extends ServiceMap.Service<
  ProjectionWorkbookRepository,
  ProjectionWorkbookRepositoryShape
>()("t3/persistence/Services/ProjectionWorkbooks/ProjectionWorkbookRepository") {}
