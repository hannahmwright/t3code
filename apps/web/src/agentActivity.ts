import { type ProviderKind, type ThreadId } from "@t3tools/contracts";
import { getModelOptions, inferProviderForModel } from "@t3tools/shared/model";
import { type Thread } from "./types";

const PROVIDER_LABELS: Record<ProviderKind, string> = {
  codex: "Codex",
  claudeAgent: "Claude",
};

export function formatThreadAgentLabel(
  thread: Pick<Thread, "model" | "session"> | null | undefined,
): string | null {
  if (!thread) return null;
  const provider = thread.session?.provider ?? inferProviderForModel(thread.model);
  const modelLabel =
    getModelOptions(provider).find((option) => option.slug === thread.model)?.name ?? thread.model;
  return `${PROVIDER_LABELS[provider]} · ${modelLabel}`;
}

export function getThreadWorkTimestampMs(
  thread: Pick<Thread, "createdAt" | "latestTurn" | "session" | "updatedAt"> | null | undefined,
): number {
  if (!thread) return Number.NEGATIVE_INFINITY;
  const candidates = [
    thread.latestTurn?.completedAt,
    thread.latestTurn?.startedAt,
    thread.session?.updatedAt,
    thread.updatedAt,
    thread.createdAt,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const timestampMs = Date.parse(candidate);
    if (!Number.isNaN(timestampMs)) {
      return timestampMs;
    }
  }
  return Number.NEGATIVE_INFINITY;
}

export function getLatestWorkThreadId(input: {
  threads: ReadonlyArray<Thread>;
  threadIds: ReadonlyArray<ThreadId>;
}): ThreadId | null {
  let latestThreadId: ThreadId | null = null;
  let latestTimestampMs = Number.NEGATIVE_INFINITY;
  const mountedThreadIds = new Set(input.threadIds);
  for (const thread of input.threads) {
    if (!mountedThreadIds.has(thread.id)) continue;
    const timestampMs = getThreadWorkTimestampMs(thread);
    if (timestampMs > latestTimestampMs) {
      latestTimestampMs = timestampMs;
      latestThreadId = thread.id;
    }
  }
  return latestThreadId;
}

export function isThreadActivelyWorking(
  thread: Pick<Thread, "latestTurn" | "session"> | null | undefined,
): boolean {
  if (!thread) return false;
  if (thread.session?.activeTurnId) return true;
  return Boolean(thread.latestTurn?.startedAt && !thread.latestTurn.completedAt);
}

export function getSplitThreadActivityLabel(
  thread: Pick<Thread, "id" | "latestTurn" | "session"> | null | undefined,
  latestWorkThreadId: ThreadId | null,
): string | null {
  if (!thread || thread.id !== latestWorkThreadId) return null;
  return isThreadActivelyWorking(thread) ? "Working now" : "Latest work";
}
