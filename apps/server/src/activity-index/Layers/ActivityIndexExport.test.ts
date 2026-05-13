import { ProjectId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import { buildActivityIndexDocument } from "./ActivityIndexExport.ts";

it("builds an activity index with project, thread, and workspace metadata", () => {
  const document = buildActivityIndexDocument({
    projects: [
      {
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Beacon",
        emoji: null,
        color: null,
        workbookId: null,
        groupName: null,
        groupEmoji: null,
        workspaceRoot: "/Users/hannahwright/Code/Beacon",
        defaultModel: null,
        scripts: [],
        createdAt: "2026-04-24T19:00:00.000Z",
        updatedAt: "2026-04-24T19:55:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        threadId: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "lets create a github repo for this please",
        model: "gpt-5.5",
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: "main",
        worktreePath: null,
        goal: null,
        latestTurnId: null,
        createdAt: "2026-04-24T19:10:00.000Z",
        updatedAt: "2026-04-24T19:56:00.000Z",
        deletedAt: null,
      },
    ],
    updatedAt: "2026-04-24T20:05:00.000Z",
    basename: (value) => value.split("/").at(-1) ?? value,
  });

  assert.deepEqual(document, {
    schemaVersion: 2,
    updatedAt: "2026-04-24T20:05:00.000Z",
    workspaces: [
      {
        workspaceId: "root:/Users/hannahwright/Code/Beacon",
        workspaceName: "Beacon",
        projectIds: ["project-1"],
        workspaceRoots: ["/Users/hannahwright/Code/Beacon"],
        updatedAt: "2026-04-24T19:55:00.000Z",
      },
    ],
    projects: [
      {
        projectId: "project-1",
        projectName: "Beacon",
        workspaceRoot: "/Users/hannahwright/Code/Beacon",
        workspaceName: "Beacon",
        updatedAt: "2026-04-24T19:55:00.000Z",
      },
    ],
    threads: [
      {
        threadId: "thread-1",
        threadName: "lets create a github repo for this please",
        projectId: "project-1",
        projectName: "Beacon",
        workspaceRoot: "/Users/hannahwright/Code/Beacon",
        workspaceName: "Beacon",
        updatedAt: "2026-04-24T19:56:00.000Z",
        branch: "main",
        worktreePath: null,
      },
    ],
  });
});
