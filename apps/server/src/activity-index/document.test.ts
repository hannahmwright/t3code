import { assert, it } from "@effect/vitest";

import {
  ACTIVITY_INDEX_SCHEMA_VERSION,
  applyThreadActivitySummary,
  mergeThreadActivitySummaries,
  selectThreadsNeedingActivitySummary,
  threadNeedsActivitySummary,
  type ActivityIndexDocument,
} from "./document.ts";

const baseDocument: ActivityIndexDocument = {
  schemaVersion: ACTIVITY_INDEX_SCHEMA_VERSION,
  updatedAt: "2026-04-28T22:00:00.000Z",
  workspaces: [
    {
      workspaceId: "root:/Users/hannahwright/Code/Beacon",
      workspaceName: "Beacon",
      projectIds: ["project-1"],
      workspaceRoots: ["/Users/hannahwright/Code/Beacon"],
      updatedAt: "2026-04-28T21:00:00.000Z",
    },
  ],
  projects: [
    {
      projectId: "project-1",
      projectName: "Beacon",
      workspaceRoot: "/Users/hannahwright/Code/Beacon",
      workspaceName: "Beacon",
      updatedAt: "2026-04-28T21:00:00.000Z",
    },
  ],
  threads: [
    {
      threadId: "thread-newest",
      threadName: "Fix notifications",
      projectId: "project-1",
      projectName: "Beacon",
      workspaceRoot: "/Users/hannahwright/Code/Beacon",
      workspaceName: "Beacon",
      updatedAt: "2026-04-28T21:59:00.000Z",
      branch: null,
      worktreePath: null,
    },
    {
      threadId: "thread-stale",
      threadName: "Build activity export",
      projectId: "project-1",
      projectName: "Beacon",
      workspaceRoot: "/Users/hannahwright/Code/Beacon",
      workspaceName: "Beacon",
      updatedAt: "2026-04-28T21:30:00.000Z",
      branch: null,
      worktreePath: null,
      activitySummary: "Older summary",
      summaryUpdatedAt: "2026-04-28T21:10:00.000Z",
    },
    {
      threadId: "thread-fresh",
      threadName: "Refresh picker models",
      projectId: "project-1",
      projectName: "Beacon",
      workspaceRoot: "/Users/hannahwright/Code/Beacon",
      workspaceName: "Beacon",
      updatedAt: "2026-04-28T21:20:00.000Z",
      branch: null,
      worktreePath: null,
      activitySummary: "Updated the model picker defaults.",
      summaryUpdatedAt: "2026-04-28T21:25:00.000Z",
    },
  ],
};

it("preserves thread summaries when rebuilding activity index rows", () => {
  const merged = mergeThreadActivitySummaries(
    baseDocument.threads.map((thread) => {
      const { activitySummary: _, summaryUpdatedAt: __, ...rest } = thread;
      return rest;
    }),
    baseDocument.threads,
  );

  assert.deepEqual(merged[1], baseDocument.threads[1]);
  assert.deepEqual(merged[2], baseDocument.threads[2]);
});

it("detects stale and missing activity summaries", () => {
  assert.equal(threadNeedsActivitySummary(baseDocument.threads[0]!), true);
  assert.equal(threadNeedsActivitySummary(baseDocument.threads[1]!), true);
  assert.equal(threadNeedsActivitySummary(baseDocument.threads[2]!), false);
});

it("selects the most recent threads that need summaries", () => {
  const selected = selectThreadsNeedingActivitySummary(baseDocument, 2);

  assert.deepEqual(
    selected.map((thread) => thread.threadId),
    ["thread-newest", "thread-stale"],
  );
});

it("only applies a summary update when the thread timestamp still matches", () => {
  const updated = applyThreadActivitySummary(baseDocument, {
    threadId: "thread-newest",
    activitySummary: "Fixing final-message notifications and preview text.",
    summaryUpdatedAt: "2026-04-28T22:05:00.000Z",
    sourceUpdatedAt: "2026-04-28T21:59:00.000Z",
  });
  const skipped = applyThreadActivitySummary(baseDocument, {
    threadId: "thread-newest",
    activitySummary: "Stale summary that should not land.",
    summaryUpdatedAt: "2026-04-28T22:05:00.000Z",
    sourceUpdatedAt: "2026-04-28T21:00:00.000Z",
  });

  assert.equal(
    updated.threads[0]?.activitySummary,
    "Fixing final-message notifications and preview text.",
  );
  assert.equal(skipped.threads[0]?.activitySummary, undefined);
});
