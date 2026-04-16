import type { NativeApi, ServerPushSubscription } from "@t3tools/contracts";

import { isElectron } from "./env";
import { registerPwaServiceWorker } from "./pwa";

const INSTALLATION_ID_STORAGE_KEY = "t3code:installation-id:v1";

export type BrowserNotificationPermissionState = NotificationPermission | "unsupported";

export function getNotificationPermissionState(): BrowserNotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }
  return Notification.permission;
}

export function supportsWebPushNotifications() {
  if (typeof window === "undefined" || isElectron) {
    return false;
  }

  return (
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    (window.isSecureContext ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")
  );
}

export function getOrCreateInstallationId() {
  if (typeof window === "undefined") {
    return "server";
  }

  const existing = window.localStorage.getItem(INSTALLATION_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const nextId = window.crypto.randomUUID();
  window.localStorage.setItem(INSTALLATION_ID_STORAGE_KEY, nextId);
  return nextId;
}

export function decodeBase64Url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
  const encoded = `${normalized}${padding}`;
  const raw = window.atob(encoded);
  const bytes = new Uint8Array(raw.length);

  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }

  return bytes;
}

export function toServerPushSubscription(
  subscription: PushSubscriptionJSON | null,
): ServerPushSubscription | null {
  if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
    return null;
  }

  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime ?? null,
    keys: {
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
    },
  };
}

export async function requestNotificationPermission(): Promise<BrowserNotificationPermissionState> {
  if (!supportsWebPushNotifications()) {
    return "unsupported";
  }

  return Notification.requestPermission();
}

export async function enablePushOnThisDevice(input: {
  readonly nativeApi: NativeApi;
  readonly installationId: string;
  readonly vapidPublicKey: string;
}) {
  const permission = await requestNotificationPermission();
  if (permission !== "granted") {
    return permission;
  }

  const registration = await registerPwaServiceWorker();
  if (!registration) {
    throw new Error("Service worker registration is unavailable.");
  }

  const existingSubscription = await registration.pushManager.getSubscription();
  const browserSubscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(input.vapidPublicKey),
    }));

  const serverSubscription = toServerPushSubscription(browserSubscription.toJSON());
  if (!serverSubscription) {
    throw new Error("Browser push subscription is missing encryption keys.");
  }

  await input.nativeApi.server.upsertPushSubscription({
    installationId: input.installationId,
    subscription: serverSubscription,
    userAgent: navigator.userAgent,
  });

  return permission;
}

export async function disablePushOnThisDevice(input: {
  readonly nativeApi: NativeApi;
  readonly installationId: string;
}) {
  const registration = await navigator.serviceWorker.getRegistration();
  const existingSubscription = await registration?.pushManager.getSubscription();
  await existingSubscription?.unsubscribe();
  await input.nativeApi.server.removePushSubscription({
    installationId: input.installationId,
  });
}

export async function syncExistingPushSubscription(input: {
  readonly nativeApi: NativeApi;
  readonly installationId: string;
}) {
  if (!supportsWebPushNotifications()) {
    return false;
  }

  const registration = await navigator.serviceWorker.getRegistration();
  const existingSubscription = await registration?.pushManager.getSubscription();
  const serverSubscription = toServerPushSubscription(existingSubscription?.toJSON() ?? null);
  if (!serverSubscription) {
    return false;
  }

  await input.nativeApi.server.upsertPushSubscription({
    installationId: input.installationId,
    subscription: serverSubscription,
    userAgent: navigator.userAgent,
  });

  return true;
}
