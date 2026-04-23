import type { OrchestrationReadModel } from "@t3tools/contracts";

export const ACTIVE_THREAD_STORAGE_KEY = "t3code:last-active-thread:v1";

function toSortableTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function readStoredActiveThreadId(
  storage: Pick<Storage, "getItem"> | null | undefined,
): string | null {
  if (!storage) {
    return null;
  }
  try {
    const value = storage.getItem(ACTIVE_THREAD_STORAGE_KEY);
    return typeof value === "string" && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredActiveThreadId(
  storage: Pick<Storage, "setItem"> | null | undefined,
  threadId: string,
): void {
  if (!storage || threadId.length === 0) {
    return;
  }
  try {
    storage.setItem(ACTIVE_THREAD_STORAGE_KEY, threadId);
  } catch {
    // Ignore storage failures so startup/navigation remain usable.
  }
}

export function selectStartupThreadId(
  snapshot: Pick<OrchestrationReadModel, "threads">,
  preferredThreadId: string | null,
): string | null {
  const activeThreads = snapshot.threads.filter((thread) => thread.deletedAt === null);

  if (activeThreads.length === 0) {
    return null;
  }

  if (preferredThreadId && activeThreads.some((thread) => thread.id === preferredThreadId)) {
    return preferredThreadId;
  }

  return (
    activeThreads
      .toSorted((left, right) => {
        const byUpdatedAt =
          toSortableTimestamp(right.updatedAt ?? right.createdAt) -
          toSortableTimestamp(left.updatedAt ?? left.createdAt);
        if (byUpdatedAt !== 0) {
          return byUpdatedAt;
        }

        const byCreatedAt =
          toSortableTimestamp(right.createdAt) - toSortableTimestamp(left.createdAt);
        if (byCreatedAt !== 0) {
          return byCreatedAt;
        }

        return right.id.localeCompare(left.id);
      })
      .at(0)?.id ?? null
  );
}
