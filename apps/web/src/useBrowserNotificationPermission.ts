import { useCallback, useEffect, useState } from "react";

import {
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type BrowserNotificationPermission,
} from "./browserNotifications";

export function useBrowserNotificationPermission() {
  const [permission, setPermission] = useState<BrowserNotificationPermission>(() =>
    getBrowserNotificationPermission(),
  );

  const refreshPermission = useCallback(() => {
    setPermission(getBrowserNotificationPermission());
  }, []);

  useEffect(() => {
    refreshPermission();
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    window.addEventListener("focus", refreshPermission);
    document.addEventListener("visibilitychange", refreshPermission);
    return () => {
      window.removeEventListener("focus", refreshPermission);
      document.removeEventListener("visibilitychange", refreshPermission);
    };
  }, [refreshPermission]);

  const requestPermission = useCallback(async () => {
    const nextPermission = await requestBrowserNotificationPermission();
    setPermission(nextPermission);
    return nextPermission;
  }, []);

  return {
    permission,
    supported: permission !== "unsupported",
    refreshPermission,
    requestPermission,
  } as const;
}
