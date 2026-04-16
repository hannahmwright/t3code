export const FOREGROUND_SNAPSHOT_RECOVERY_MIN_INTERVAL_MS = 15_000;

export function shouldRunForegroundSnapshotRecovery(input: {
  isVisible: boolean;
  pendingBackgroundedAtMs: number | null;
  lastForegroundRecoveryAtMs: number | null;
  nowMs: number;
  minIntervalMs?: number;
}): boolean {
  if (!input.isVisible || input.pendingBackgroundedAtMs === null) {
    return false;
  }

  const minIntervalMs = input.minIntervalMs ?? FOREGROUND_SNAPSHOT_RECOVERY_MIN_INTERVAL_MS;
  if (
    input.lastForegroundRecoveryAtMs !== null &&
    input.nowMs - input.lastForegroundRecoveryAtMs < minIntervalMs
  ) {
    return false;
  }

  return true;
}
