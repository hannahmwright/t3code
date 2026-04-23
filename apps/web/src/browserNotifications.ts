import type { BrowserPushSubscription as BrowserPushSubscriptionPayload } from "@t3tools/contracts";

export type BrowserNotificationPermission = NotificationPermission | "unsupported";

export interface AppNotificationInput {
  readonly title: string;
  readonly body?: string;
  readonly tag?: string;
  readonly url?: string;
  readonly renotify?: boolean;
}

const NOTIFICATION_SERVICE_WORKER_URL = "/notifications-sw.js";
let notificationServiceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null =
  null;

export function isBrowserNotificationSupported(): boolean {
  return typeof window !== "undefined" && typeof Notification !== "undefined";
}

export function isBrowserPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof PushManager !== "undefined" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator
  );
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!isBrowserNotificationSupported()) {
    return "unsupported";
  }
  return Notification.permission;
}

export async function ensureNotificationServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  notificationServiceWorkerRegistrationPromise ??= navigator.serviceWorker
    .register(NOTIFICATION_SERVICE_WORKER_URL)
    .catch(() => null);

  return notificationServiceWorkerRegistrationPromise;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!isBrowserNotificationSupported()) {
    return "unsupported";
  }

  await ensureNotificationServiceWorkerRegistration().catch(() => null);
  return Notification.requestPermission();
}

function buildNotificationOptions(input: AppNotificationInput): NotificationOptions {
  return {
    ...(input.body ? { body: input.body } : {}),
    ...(input.tag ? { tag: input.tag } : {}),
    ...(input.renotify !== undefined ? { renotify: input.renotify } : {}),
    badge: "/favicon-32x32.png",
    icon: "/apple-touch-icon.png",
    data: {
      url: input.url ?? null,
    },
  };
}

function normalizeBrowserPushSubscription(
  subscription: Pick<PushSubscription, "toJSON">,
): BrowserPushSubscriptionPayload | null {
  const json = subscription.toJSON();
  const endpoint = json.endpoint?.trim();
  const auth = json.keys?.auth?.trim();
  const p256dh = json.keys?.p256dh?.trim();

  if (!endpoint || !auth || !p256dh) {
    return null;
  }

  return {
    endpoint,
    expirationTime: typeof json.expirationTime === "number" ? json.expirationTime : null,
    keys: {
      auth,
      p256dh,
    },
  };
}

function decodeBase64Url(base64Url: string): ArrayBuffer {
  const normalized = base64Url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  const encoded = window.atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  return bytes.buffer;
}

function toUint8Array(value: BufferSource | null | undefined): Uint8Array | null {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

export function doesPushSubscriptionMatchPublicKey(
  subscription: Pick<PushSubscription, "options">,
  publicKey: string,
): boolean {
  const subscriptionKey = toUint8Array(subscription.options.applicationServerKey);
  if (!subscriptionKey) {
    return true;
  }

  const expectedKey = new Uint8Array(decodeBase64Url(publicKey));
  if (subscriptionKey.byteLength !== expectedKey.byteLength) {
    return false;
  }

  for (let index = 0; index < subscriptionKey.byteLength; index += 1) {
    if (subscriptionKey[index] !== expectedKey[index]) {
      return false;
    }
  }

  return true;
}

export async function subscribeToBrowserPush(
  publicKey: string,
): Promise<BrowserPushSubscriptionPayload | null> {
  if (!isBrowserPushSupported() || getBrowserNotificationPermission() !== "granted") {
    return null;
  }

  const registration = await ensureNotificationServiceWorkerRegistration();
  if (!registration) {
    return null;
  }

  const existing = await registration.pushManager.getSubscription();
  const normalizedExisting = existing ? normalizeBrowserPushSubscription(existing) : null;
  if (existing && normalizedExisting && doesPushSubscriptionMatchPublicKey(existing, publicKey)) {
    return normalizedExisting;
  }
  if (existing) {
    await existing.unsubscribe().catch(() => false);
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(publicKey),
  });
  return normalizeBrowserPushSubscription(subscription);
}

export async function removeBrowserPushSubscription(): Promise<string | null> {
  if (!isBrowserPushSupported()) {
    return null;
  }

  const registration = await ensureNotificationServiceWorkerRegistration();
  if (!registration) {
    return null;
  }

  const existing = await registration.pushManager.getSubscription();
  if (!existing) {
    return null;
  }

  const endpoint = normalizeBrowserPushSubscription(existing)?.endpoint ?? null;
  await existing.unsubscribe().catch(() => false);
  return endpoint;
}

export async function showAppNotification(input: AppNotificationInput): Promise<boolean> {
  if (getBrowserNotificationPermission() !== "granted") {
    return false;
  }

  const options = buildNotificationOptions(input);
  const registration = await ensureNotificationServiceWorkerRegistration().catch(() => null);
  if (registration) {
    await registration.showNotification(input.title, options);
    return true;
  }

  if (!isBrowserNotificationSupported()) {
    return false;
  }

  const notification = new Notification(input.title, options);
  const { url } = input;
  if (url) {
    notification.addEventListener("click", () => {
      window.focus();
      window.location.assign(url);
      notification.close();
    });
  }

  return true;
}
