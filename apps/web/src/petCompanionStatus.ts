import type { ThreadId } from "@t3tools/contracts";

import {
  resolvePetStateFromThreadActivity,
  resolvePetStatusLabel,
  type CodexPetStateId,
} from "./petCompanion";
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  isSessionActivelyRunningTurn,
} from "./session-logic";
import type { Thread } from "./types";

export interface PetCompanionRuntimeSnapshot {
  petState: CodexPetStateId;
  statusLabel: string;
  statusThread: Thread | null;
}

interface ClassifiedPetThreads {
  waitingThreads: Thread[];
  runningThreads: Thread[];
  reviewThreads: Thread[];
  errorThreads: Thread[];
}

export function derivePetCompanionRuntimeSnapshot(
  threads: readonly Thread[],
  activeThreadId: ThreadId | string | null = null,
): PetCompanionRuntimeSnapshot {
  const classified = classifyPetThreads(threads, activeThreadId);
  const activity = {
    waitingThreadCount: classified.waitingThreads.length,
    runningThreadCount: classified.runningThreads.length,
    errorThreadCount: classified.errorThreads.length,
    reviewThreadCount: classified.reviewThreads.length,
  };
  const petState = resolvePetStateFromThreadActivity(activity);
  return {
    petState,
    statusLabel: resolvePetStatusLabel(activity),
    statusThread: selectStatusThreadForState(classified, petState, activeThreadId),
  };
}

function classifyPetThreads(
  threads: readonly Thread[],
  activeThreadId: ThreadId | string | null,
): ClassifiedPetThreads {
  const waitingThreads: Thread[] = [];
  const runningThreads: Thread[] = [];
  const reviewThreads: Thread[] = [];
  const errorThreads: Thread[] = [];

  for (const thread of threads) {
    if (isThreadWaitingForPet(thread)) {
      waitingThreads.push(thread);
      continue;
    }
    if (isThreadWorkingForPet(thread)) {
      runningThreads.push(thread);
      continue;
    }
    if (isThreadReviewReadyForPet(thread)) {
      reviewThreads.push(thread);
      continue;
    }
    if (isThreadErroredForPet(thread, activeThreadId)) {
      errorThreads.push(thread);
    }
  }

  return { waitingThreads, runningThreads, reviewThreads, errorThreads };
}

function isThreadWaitingForPet(thread: Thread): boolean {
  if (!isThreadLiveForPet(thread)) return false;
  return (
    derivePendingApprovals(thread.activities).length > 0 ||
    derivePendingUserInputs(thread.activities).length > 0
  );
}

function isThreadWorkingForPet(thread: Thread): boolean {
  return isThreadLiveForPet(thread);
}

function isThreadLiveForPet(thread: Thread): boolean {
  return (
    isSessionActivelyRunningTurn(thread.latestTurn, thread.session) ||
    thread.messages.some((message) => message.streaming)
  );
}

function isThreadErroredForPet(thread: Thread, activeThreadId: ThreadId | string | null): boolean {
  if (!activeThreadId || thread.id !== activeThreadId) return false;
  return (
    thread.session?.orchestrationStatus === "error" ||
    thread.session?.status === "error" ||
    thread.latestTurn?.state === "error" ||
    thread.error !== null
  );
}

function isThreadReviewReadyForPet(thread: Thread): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  if (thread.latestTurn.state === "error") return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  const lastVisitedAt = thread.lastVisitedAt ? Date.parse(thread.lastVisitedAt) : NaN;
  if (!Number.isFinite(completedAt)) return false;
  return !Number.isFinite(lastVisitedAt) || completedAt > lastVisitedAt;
}

function selectStatusThreadForState(
  threads: ClassifiedPetThreads,
  state: CodexPetStateId,
  activeThreadId: ThreadId | string | null,
): Thread | null {
  const candidates =
    state === "waiting"
      ? threads.waitingThreads
      : state === "running"
        ? threads.runningThreads
        : state === "review"
          ? threads.reviewThreads
          : state === "failed"
            ? threads.errorThreads
            : [];
  return preferredThread(candidates, activeThreadId);
}

function preferredThread(
  threads: readonly Thread[],
  activeThreadId: ThreadId | string | null,
): Thread | null {
  if (activeThreadId) {
    const activeThread = threads.find((thread) => thread.id === activeThreadId);
    if (activeThread) return activeThread;
  }
  return newestThread(threads);
}

function newestThread(threads: readonly Thread[]): Thread | null {
  let newest: Thread | null = null;
  let newestTime = -Infinity;
  for (const thread of threads) {
    const time = threadPetActivityTime(thread);
    if (time <= newestTime) continue;
    newest = thread;
    newestTime = time;
  }
  return newest;
}

function threadPetActivityTime(thread: Thread): number {
  const candidates = [
    thread.updatedAt,
    thread.latestTurn?.startedAt,
    thread.latestTurn?.completedAt,
    thread.session?.updatedAt,
    thread.messages.at(-1)?.createdAt,
  ];
  return Math.max(
    0,
    ...candidates.map((value) => {
      if (!value) return 0;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }),
  );
}
