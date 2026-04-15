import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { isElectron } from "../env";
import {
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getNotificationPermissionState,
  getOrCreateInstallationId,
  syncExistingPushSubscription,
  type BrowserNotificationPermissionState,
  supportsWebPushNotifications,
} from "../notifications";
import { ensureNativeApi } from "../nativeApi";
import { usePwaInstallState } from "../pwa";

export function useWebNotifications() {
  const nativeApi = useMemo(() => ensureNativeApi(), []);
  const installationId = useMemo(() => getOrCreateInstallationId(), []);
  const installState = usePwaInstallState();
  const supportsBrowserPush = supportsWebPushNotifications();
  const [permission, setPermission] = useState<BrowserNotificationPermissionState>(() =>
    getNotificationPermissionState(),
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    const refreshPermission = () => {
      setPermission(getNotificationPermissionState());
    };

    refreshPermission();
    document.addEventListener("visibilitychange", refreshPermission);
    window.addEventListener("focus", refreshPermission);
    return () => {
      document.removeEventListener("visibilitychange", refreshPermission);
      window.removeEventListener("focus", refreshPermission);
    };
  }, []);

  const notificationsQuery = useQuery({
    queryKey: ["server", "notifications", installationId],
    queryFn: () => nativeApi.server.getNotificationsState({ installationId }),
    enabled: !isElectron,
  });

  useEffect(() => {
    if (
      isElectron ||
      permission !== "granted" ||
      !supportsBrowserPush ||
      notificationsQuery.isLoading ||
      notificationsQuery.data?.supported === false ||
      notificationsQuery.data?.subscribed === true
    ) {
      return;
    }

    let cancelled = false;

    void syncExistingPushSubscription({
      nativeApi,
      installationId,
    })
      .then((synced) => {
        if (!synced || cancelled) {
          return;
        }
        void notificationsQuery.refetch();
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    installationId,
    nativeApi,
    notificationsQuery,
    permission,
    supportsBrowserPush,
  ]);

  const enable = async () => {
    if (!notificationsQuery.data?.vapidPublicKey) {
      return;
    }

    setIsSaving(true);
    try {
      const nextPermission = await enablePushOnThisDevice({
        nativeApi,
        installationId,
        vapidPublicKey: notificationsQuery.data.vapidPublicKey,
      });
      setPermission(nextPermission);
      await notificationsQuery.refetch();
    } finally {
      setIsSaving(false);
    }
  };

  const disable = async () => {
    setIsSaving(true);
    try {
      await disablePushOnThisDevice({ nativeApi, installationId });
      await notificationsQuery.refetch();
    } finally {
      setIsSaving(false);
    }
  };

  return {
    installationId,
    installState,
    permission,
    supportsBrowserPush,
    isSaving,
    query: notificationsQuery,
    enable,
    disable,
  };
}
