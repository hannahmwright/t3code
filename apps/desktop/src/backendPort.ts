import { DEFAULT_LOCAL_SERVER_PORT } from "@t3tools/shared/serverDefaults";

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= 65_535;
}

export function resolveDesktopBackendPort(rawPort: string | undefined): number {
  const trimmed = rawPort?.trim();
  if (!trimmed) {
    return DEFAULT_LOCAL_SERVER_PORT;
  }

  const parsed = Number(trimmed);
  return isValidPort(parsed) ? parsed : DEFAULT_LOCAL_SERVER_PORT;
}
