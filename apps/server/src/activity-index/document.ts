export const ACTIVITY_INDEX_SCHEMA_VERSION = 2 as const;

export interface ActivityIndexWorkspaceEntry {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly projectIds: ReadonlyArray<string>;
  readonly workspaceRoots: ReadonlyArray<string>;
  readonly updatedAt: string;
}

export interface ActivityIndexProjectEntry {
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceRoot: string;
  readonly workspaceName: string;
  readonly updatedAt: string;
}

export interface ActivityIndexThreadEntry {
  readonly threadId: string;
  readonly threadName: string;
  readonly projectId: string | null;
  readonly projectName: string | null;
  readonly workspaceRoot: string | null;
  readonly workspaceName: string | null;
  readonly updatedAt: string;
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly activitySummary?: string;
  readonly summaryUpdatedAt?: string;
}

export interface ActivityIndexDocument {
  readonly schemaVersion: typeof ACTIVITY_INDEX_SCHEMA_VERSION;
  readonly updatedAt: string;
  readonly workspaces: ReadonlyArray<ActivityIndexWorkspaceEntry>;
  readonly projects: ReadonlyArray<ActivityIndexProjectEntry>;
  readonly threads: ReadonlyArray<ActivityIndexThreadEntry>;
}

export interface ThreadActivitySummaryUpdateInput {
  readonly threadId: string;
  readonly activitySummary: string;
  readonly summaryUpdatedAt: string;
  readonly sourceUpdatedAt: string;
}

export function mergeThreadActivitySummaries(
  threads: ReadonlyArray<ActivityIndexThreadEntry>,
  existingThreads: ReadonlyArray<ActivityIndexThreadEntry> | undefined,
): ReadonlyArray<ActivityIndexThreadEntry> {
  if (!existingThreads || existingThreads.length === 0) {
    return threads;
  }

  const summariesByThreadId = new Map(
    existingThreads
      .filter(
        (thread) =>
          typeof thread.activitySummary === "string" && typeof thread.summaryUpdatedAt === "string",
      )
      .map((thread) => [
        thread.threadId,
        {
          activitySummary: thread.activitySummary!,
          summaryUpdatedAt: thread.summaryUpdatedAt!,
        },
      ]),
  );

  return threads.map((thread) => {
    const summary = summariesByThreadId.get(thread.threadId);
    if (!summary) {
      return thread;
    }

    return {
      ...thread,
      activitySummary: summary.activitySummary,
      summaryUpdatedAt: summary.summaryUpdatedAt,
    };
  });
}

export function threadNeedsActivitySummary(thread: ActivityIndexThreadEntry): boolean {
  if (!thread.summaryUpdatedAt || !thread.activitySummary) {
    return true;
  }

  return thread.summaryUpdatedAt < thread.updatedAt;
}

export function selectThreadsNeedingActivitySummary(
  document: ActivityIndexDocument,
  maxThreads: number,
): ReadonlyArray<ActivityIndexThreadEntry> {
  return document.threads.filter(threadNeedsActivitySummary).slice(0, maxThreads);
}

export function applyThreadActivitySummary(
  document: ActivityIndexDocument,
  input: ThreadActivitySummaryUpdateInput,
): ActivityIndexDocument {
  return {
    ...document,
    threads: document.threads.map((thread) =>
      thread.threadId === input.threadId && thread.updatedAt === input.sourceUpdatedAt
        ? {
            ...thread,
            activitySummary: input.activitySummary,
            summaryUpdatedAt: input.summaryUpdatedAt,
          }
        : thread,
    ),
  };
}
