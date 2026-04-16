import type { Thread } from "./types";

export const ACTIVE_RUNNING_THREAD_SNAPSHOT_POLL_INTERVAL_MS = 5_000;

export function shouldRecoverActiveThreadSnapshot(input: {
  bootstrapComplete: boolean;
  draftThreadExists: boolean;
  routeThreadExists: boolean;
  isElectron: boolean;
  visibilityState: DocumentVisibilityState | "visible";
  thread: Pick<Thread, "session" | "latestTurn"> | null;
}): boolean {
  if (
    !input.bootstrapComplete ||
    input.draftThreadExists ||
    !input.routeThreadExists ||
    input.isElectron ||
    input.visibilityState !== "visible"
  ) {
    return false;
  }

  return (
    input.thread?.session?.status === "running" || input.thread?.latestTurn?.state === "running"
  );
}
