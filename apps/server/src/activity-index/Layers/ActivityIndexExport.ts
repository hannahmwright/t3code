import { Effect, FileSystem, Layer, Path } from "effect";
import * as Semaphore from "effect/Semaphore";

import { ServerConfig } from "../../config.ts";
import { ProjectionProjectRepositoryLive } from "../../persistence/Layers/ProjectionProjects.ts";
import { ProjectionThreadRepositoryLive } from "../../persistence/Layers/ProjectionThreads.ts";
import {
  ProjectionProjectRepository,
  type ProjectionProject,
} from "../../persistence/Services/ProjectionProjects.ts";
import {
  ProjectionThreadRepository,
  type ProjectionThread,
} from "../../persistence/Services/ProjectionThreads.ts";
import {
  ActivityIndexExport,
  ActivityIndexExportError,
  type ActivityIndexExportShape,
} from "../Services/ActivityIndexExport.ts";
import {
  ACTIVITY_INDEX_SCHEMA_VERSION,
  applyThreadActivitySummary,
  type ActivityIndexDocument,
  type ActivityIndexThreadEntry,
  mergeThreadActivitySummaries,
} from "../document.ts";

export const ACTIVITY_INDEX_FILE_NAME = "activity-index.json";

function compareUpdatedAtDesc<T extends { readonly updatedAt: string }>(left: T, right: T): number {
  const updatedComparison = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedComparison !== 0) {
    return updatedComparison;
  }
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function getWorkspaceName(workspaceRoot: string, basename: (path: string) => string): string {
  const workspaceName = basename(workspaceRoot).trim();
  return workspaceName.length > 0 ? workspaceName : workspaceRoot;
}

function getProjectWorkspaceName(
  project: ProjectionProject,
  basename: (path: string) => string,
): string {
  return project.groupName?.trim() || getWorkspaceName(project.workspaceRoot, basename);
}

function getProjectWorkspaceId(project: ProjectionProject): string {
  return project.workbookId ?? `root:${project.workspaceRoot}`;
}

export function buildActivityIndexDocument(input: {
  readonly projects: ReadonlyArray<ProjectionProject>;
  readonly threads: ReadonlyArray<ProjectionThread>;
  readonly updatedAt: string;
  readonly basename: (path: string) => string;
}): ActivityIndexDocument {
  const activeProjects = input.projects.filter((project) => project.deletedAt === null);
  const projectsById = new Map(
    activeProjects.map((project) => [project.projectId, project] as const),
  );
  const workspacesById = new Map<
    string,
    {
      workspaceName: string;
      projectIds: string[];
      workspaceRoots: Set<string>;
      updatedAt: string;
    }
  >();

  for (const project of activeProjects) {
    const workspaceId = getProjectWorkspaceId(project);
    const existing = workspacesById.get(workspaceId);
    if (existing) {
      existing.projectIds.push(project.projectId);
      existing.workspaceRoots.add(project.workspaceRoot);
      if (project.updatedAt > existing.updatedAt) {
        existing.updatedAt = project.updatedAt;
      }
      continue;
    }
    workspacesById.set(workspaceId, {
      workspaceName: getProjectWorkspaceName(project, input.basename),
      projectIds: [project.projectId],
      workspaceRoots: new Set([project.workspaceRoot]),
      updatedAt: project.updatedAt,
    });
  }

  const workspaces = Array.from(workspacesById.entries())
    .map(([workspaceId, workspace]) => ({
      workspaceId,
      workspaceName: workspace.workspaceName,
      projectIds: workspace.projectIds.toSorted((left, right) => left.localeCompare(right)),
      workspaceRoots: Array.from(workspace.workspaceRoots).toSorted((left, right) =>
        left.localeCompare(right),
      ),
      updatedAt: workspace.updatedAt,
    }))
    .toSorted(compareUpdatedAtDesc);

  const projects = activeProjects
    .map((project) => ({
      projectId: project.projectId,
      projectName: project.title,
      workspaceRoot: project.workspaceRoot,
      workspaceName: getProjectWorkspaceName(project, input.basename),
      updatedAt: project.updatedAt,
    }))
    .toSorted(compareUpdatedAtDesc);

  const threads = input.threads
    .filter((thread) => thread.deletedAt === null)
    .flatMap((thread): ActivityIndexThreadEntry[] => {
      const project = thread.projectId ? projectsById.get(thread.projectId) : undefined;
      if (!project) {
        if (thread.projectId !== null) {
          return [];
        }

        return [
          {
            threadId: thread.threadId,
            threadName: thread.title,
            projectId: null,
            projectName: null,
            workspaceRoot: null,
            workspaceName: null,
            updatedAt: thread.updatedAt,
            branch: thread.branch,
            worktreePath: thread.worktreePath,
          } satisfies ActivityIndexThreadEntry,
        ];
      }

      return [
        {
          threadId: thread.threadId,
          threadName: thread.title,
          projectId: project.projectId,
          projectName: project.title,
          workspaceRoot: project.workspaceRoot,
          workspaceName: getProjectWorkspaceName(project, input.basename),
          updatedAt: thread.updatedAt,
          branch: thread.branch,
          worktreePath: thread.worktreePath,
        } satisfies ActivityIndexThreadEntry,
      ];
    })
    .toSorted(compareUpdatedAtDesc);

  return {
    schemaVersion: ACTIVITY_INDEX_SCHEMA_VERSION,
    updatedAt: input.updatedAt,
    workspaces,
    projects,
    threads,
  };
}

const makeActivityIndexExport = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const projectionProjectRepository = yield* ProjectionProjectRepository;
  const projectionThreadRepository = yield* ProjectionThreadRepository;
  const { stateDir } = yield* ServerConfig;
  const writeSemaphore = yield* Semaphore.make(1);

  const filePath = path.join(stateDir, ACTIVITY_INDEX_FILE_NAME);

  const writeDocumentAtomically = (document: ActivityIndexDocument) => {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const encoded = `${JSON.stringify(document, null, 2)}\n`;

    return fileSystem.makeDirectory(path.dirname(filePath), { recursive: true }).pipe(
      Effect.flatMap(() => fileSystem.writeFileString(tempPath, encoded)),
      Effect.flatMap(() => fileSystem.rename(tempPath, filePath)),
    );
  };

  const readDocumentUnsafe = () =>
    fileSystem
      .exists(filePath)
      .pipe(
        Effect.flatMap((exists) =>
          exists
            ? fileSystem
                .readFileString(filePath)
                .pipe(Effect.map((content) => JSON.parse(content) as ActivityIndexDocument))
            : Effect.sync(() => undefined),
        ),
      );

  const buildLatestDocument = () =>
    Effect.all([projectionProjectRepository.listAll(), projectionThreadRepository.listAll()]).pipe(
      Effect.map(([projects, threads]) =>
        buildActivityIndexDocument({
          projects,
          threads,
          updatedAt: new Date().toISOString(),
          basename: path.basename,
        }),
      ),
    );

  const readDocument: ActivityIndexExportShape["readDocument"] = () =>
    writeSemaphore.withPermits(1)(
      readDocumentUnsafe().pipe(
        Effect.mapError(
          (cause) =>
            new ActivityIndexExportError({
              message: "Failed to read activity index export.",
              cause,
            }),
        ),
      ),
    );

  const refresh: ActivityIndexExportShape["refresh"] = () =>
    writeSemaphore.withPermits(1)(
      Effect.all([buildLatestDocument(), readDocumentUnsafe()]).pipe(
        Effect.map(([latestDocument, existingDocument]) => ({
          ...latestDocument,
          threads: mergeThreadActivitySummaries(latestDocument.threads, existingDocument?.threads),
        })),
        Effect.flatMap(writeDocumentAtomically),
        Effect.mapError(
          (cause) =>
            new ActivityIndexExportError({
              message: "Failed to refresh activity index export.",
              cause,
            }),
        ),
      ),
    );

  const upsertThreadSummary: ActivityIndexExportShape["upsertThreadSummary"] = (input) =>
    writeSemaphore.withPermits(1)(
      Effect.gen(function* () {
        const existingDocument = yield* readDocumentUnsafe();
        const document =
          existingDocument ??
          (yield* buildLatestDocument().pipe(
            Effect.map((latestDocument) => ({
              ...latestDocument,
              threads: mergeThreadActivitySummaries(latestDocument.threads, undefined),
            })),
          ));
        const thread = document.threads.find((entry) => entry.threadId === input.threadId);
        if (!thread || thread.updatedAt !== input.sourceUpdatedAt) {
          return false;
        }

        const nextDocument = {
          ...applyThreadActivitySummary(document, input),
          updatedAt: input.summaryUpdatedAt,
        };
        yield* writeDocumentAtomically(nextDocument);
        return true;
      }).pipe(
        Effect.mapError(
          (cause) =>
            new ActivityIndexExportError({
              message: "Failed to update activity summary in activity index export.",
              cause,
            }),
        ),
      ),
    );

  return {
    filePath,
    readDocument,
    refresh,
    upsertThreadSummary,
  } satisfies ActivityIndexExportShape;
});

export const ActivityIndexExportLive = Layer.effect(
  ActivityIndexExport,
  makeActivityIndexExport,
).pipe(
  Layer.provide(Layer.mergeAll(ProjectionProjectRepositoryLive, ProjectionThreadRepositoryLive)),
);
