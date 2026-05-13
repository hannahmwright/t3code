import * as Schema from "effect/Schema";
import { useCallback, useMemo } from "react";
import type { ServerProviderStatus } from "@t3tools/contracts";

import { useLocalStorage } from "../hooks/useLocalStorage";

export const DISMISSED_ALERT_KEYS_STORAGE_KEY = "t3code:dismissed-alerts:v1";
export const DISMISSED_ALERT_KEYS_SCHEMA = Schema.Array(Schema.String);
export const ARM64_INTEL_BUILD_ALERT_KEY = "desktop-runtime:arm64-intel-build-warning";

export function dismissAlertKey(
  keys: ReadonlyArray<string>,
  alertKey: string,
): ReadonlyArray<string> {
  if (keys.includes(alertKey)) {
    return keys;
  }
  return [...keys, alertKey];
}

export function buildProviderHealthAlertKey(status: ServerProviderStatus): string {
  return [
    "provider-health",
    status.provider,
    status.status,
    status.authStatus,
    status.message ?? "",
  ].join(":");
}

export function useDismissedAlert(alertKey: string | null): {
  readonly dismissed: boolean;
  readonly dismiss: () => void;
} {
  const [dismissedAlertKeys, setDismissedAlertKeys] = useLocalStorage(
    DISMISSED_ALERT_KEYS_STORAGE_KEY,
    [] as string[],
    DISMISSED_ALERT_KEYS_SCHEMA,
  );

  const dismissed = useMemo(
    () => (alertKey ? dismissedAlertKeys.includes(alertKey) : false),
    [alertKey, dismissedAlertKeys],
  );

  const dismiss = useCallback(() => {
    if (!alertKey) {
      return;
    }
    setDismissedAlertKeys((currentKeys) => dismissAlertKey(currentKeys, alertKey));
  }, [alertKey, setDismissedAlertKeys]);

  return { dismissed, dismiss };
}
