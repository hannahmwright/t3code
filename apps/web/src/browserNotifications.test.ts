import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type NotificationConstructor = typeof Notification;
type WindowOverrides = Omit<Partial<Window & typeof globalThis>, "location" | "Notification"> & {
  location?: Partial<Location>;
  Notification?: NotificationConstructor | undefined;
};

function NotificationMockBase() {}
function PushManagerMock() {}

function makeStaticNotificationMock(
  properties: Partial<Pick<NotificationConstructor, "permission" | "requestPermission">>,
): NotificationConstructor {
  Object.assign(NotificationMockBase, properties);
  return NotificationMockBase as unknown as NotificationConstructor;
}

function setWindowForTest(input?: WindowOverrides) {
  const focus = vi.fn();
  const assign = vi.fn();
  const location = {
    origin: "https://example.com",
    assign,
    ...input?.location,
  };
  const windowValue = {
    focus,
    location,
    atob: globalThis.atob,
    Notification: globalThis.Notification,
    ...input,
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: windowValue,
  });

  return { focus, assign };
}

function setNavigatorForTest(input?: Partial<Navigator>) {
  const navigatorValue = input ? { ...input } : {};
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: navigatorValue,
  });
}

describe("browserNotifications", () => {
  const originalNotification = globalThis.Notification;
  const originalPushManager = globalThis.PushManager;
  const originalNavigator = globalThis.navigator;
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: originalNotification,
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: originalPushManager,
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow,
    });
    vi.restoreAllMocks();
  });

  it("reports unsupported when the Notification API is absent", async () => {
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: undefined,
    });
    setWindowForTest({ Notification: undefined });

    const { getBrowserNotificationPermission } = await import("./browserNotifications");
    expect(getBrowserNotificationPermission()).toBe("unsupported");
  });

  it("registers the notification service worker before requesting permission", async () => {
    const register = vi.fn().mockResolvedValue(null);
    const requestPermission = vi.fn().mockResolvedValue("granted");
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: makeStaticNotificationMock({
        permission: "default",
        requestPermission,
      }),
    });
    setWindowForTest({ Notification: globalThis.Notification });
    setNavigatorForTest({
      serviceWorker: {
        register,
      } as unknown as Navigator["serviceWorker"],
    });

    const { requestBrowserNotificationPermission } = await import("./browserNotifications");
    await expect(requestBrowserNotificationPermission()).resolves.toBe("granted");
    expect(register).toHaveBeenCalledWith("/notifications-sw.js");
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("uses the service worker registration to show notifications when available", async () => {
    const showNotification = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: makeStaticNotificationMock({
        permission: "granted",
      }),
    });
    setWindowForTest({ Notification: globalThis.Notification });
    setNavigatorForTest({
      serviceWorker: {
        register: vi.fn().mockResolvedValue({ showNotification }),
      } as unknown as Navigator["serviceWorker"],
    });

    const { showAppNotification } = await import("./browserNotifications");
    await expect(
      showAppNotification({
        title: "Turn complete",
        body: "Worked for 12s",
        url: "https://example.com/thread-1",
      }),
    ).resolves.toBe(true);
    expect(showNotification).toHaveBeenCalledWith(
      "Turn complete",
      expect.objectContaining({
        body: "Worked for 12s",
        data: { url: "https://example.com/thread-1" },
      }),
    );
  });

  it("creates a browser push subscription from the service worker registration", async () => {
    const subscribe = vi.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://push.example/subscription-1",
        expirationTime: null,
        keys: {
          auth: "auth-token",
          p256dh: "p256dh-token",
        },
      }),
    });
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: makeStaticNotificationMock({
        permission: "granted",
      }),
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: PushManagerMock,
    });
    setWindowForTest({ Notification: globalThis.Notification, isSecureContext: true });
    setNavigatorForTest({
      serviceWorker: {
        register: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(null),
            subscribe,
          },
        }),
      } as unknown as Navigator["serviceWorker"],
    });

    const { subscribeToBrowserPush } = await import("./browserNotifications");
    await expect(subscribeToBrowserPush("AQIDBA")).resolves.toEqual({
      endpoint: "https://push.example/subscription-1",
      expirationTime: null,
      keys: {
        auth: "auth-token",
        p256dh: "p256dh-token",
      },
    });
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(ArrayBuffer),
    });
  });

  it("reuses an existing push subscription when it already matches the current public key", async () => {
    const subscribe = vi.fn();
    const existingSubscription = {
      toJSON: () => ({
        endpoint: "https://push.example/subscription-1",
        expirationTime: null,
        keys: {
          auth: "auth-token",
          p256dh: "p256dh-token",
        },
      }),
      options: {
        applicationServerKey: Uint8Array.from([1, 2, 3, 4]).buffer,
      },
      unsubscribe: vi.fn(),
    };
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: makeStaticNotificationMock({
        permission: "granted",
      }),
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: PushManagerMock,
    });
    setWindowForTest({ Notification: globalThis.Notification, isSecureContext: true });
    setNavigatorForTest({
      serviceWorker: {
        register: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(existingSubscription),
            subscribe,
          },
        }),
      } as unknown as Navigator["serviceWorker"],
    });

    const { subscribeToBrowserPush } = await import("./browserNotifications");
    await expect(subscribeToBrowserPush("AQIDBA")).resolves.toEqual({
      endpoint: "https://push.example/subscription-1",
      expirationTime: null,
      keys: {
        auth: "auth-token",
        p256dh: "p256dh-token",
      },
    });
    expect(existingSubscription.unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("replaces an existing push subscription when it was created with a different public key", async () => {
    const subscribe = vi.fn().mockResolvedValue({
      toJSON: () => ({
        endpoint: "https://push.example/subscription-2",
        expirationTime: null,
        keys: {
          auth: "auth-token-2",
          p256dh: "p256dh-token-2",
        },
      }),
    });
    const existingSubscription = {
      toJSON: () => ({
        endpoint: "https://push.example/subscription-1",
        expirationTime: null,
        keys: {
          auth: "auth-token",
          p256dh: "p256dh-token",
        },
      }),
      options: {
        applicationServerKey: Uint8Array.from([9, 9, 9, 9]).buffer,
      },
      unsubscribe: vi.fn().mockResolvedValue(true),
    };
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: makeStaticNotificationMock({
        permission: "granted",
      }),
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: PushManagerMock,
    });
    setWindowForTest({ Notification: globalThis.Notification, isSecureContext: true });
    setNavigatorForTest({
      serviceWorker: {
        register: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue(existingSubscription),
            subscribe,
          },
        }),
      } as unknown as Navigator["serviceWorker"],
    });

    const { subscribeToBrowserPush } = await import("./browserNotifications");
    await expect(subscribeToBrowserPush("AQIDBA")).resolves.toEqual({
      endpoint: "https://push.example/subscription-2",
      expirationTime: null,
      keys: {
        auth: "auth-token-2",
        p256dh: "p256dh-token-2",
      },
    });
    expect(existingSubscription.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(ArrayBuffer),
    });
  });

  it("removes an existing browser push subscription", async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true);
    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: makeStaticNotificationMock({
        permission: "granted",
      }),
    });
    Object.defineProperty(globalThis, "PushManager", {
      configurable: true,
      value: PushManagerMock,
    });
    setWindowForTest({ Notification: globalThis.Notification, isSecureContext: true });
    setNavigatorForTest({
      serviceWorker: {
        register: vi.fn().mockResolvedValue({
          pushManager: {
            getSubscription: vi.fn().mockResolvedValue({
              toJSON: () => ({
                endpoint: "https://push.example/subscription-1",
                expirationTime: null,
                keys: {
                  auth: "auth-token",
                  p256dh: "p256dh-token",
                },
              }),
              unsubscribe,
            }),
          },
        }),
      } as unknown as Navigator["serviceWorker"],
    });

    const { removeBrowserPushSubscription } = await import("./browserNotifications");
    await expect(removeBrowserPushSubscription()).resolves.toBe(
      "https://push.example/subscription-1",
    );
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("falls back to the Notification constructor when no service worker is available", async () => {
    const instances: Array<{ click: () => void; close: ReturnType<typeof vi.fn> }> = [];
    class MockNotification {
      static permission: NotificationPermission = "granted";
      private clickListener: (() => void) | null = null;
      close = vi.fn();

      constructor(_title: string, _options?: NotificationOptions) {
        instances.push(this);
      }

      addEventListener(type: string, listener: () => void) {
        if (type === "click") {
          this.clickListener = listener;
        }
      }

      click() {
        this.clickListener?.();
      }
    }

    Object.defineProperty(globalThis, "Notification", {
      configurable: true,
      value: MockNotification as unknown as NotificationConstructor,
    });
    const { focus, assign } = setWindowForTest({ Notification: globalThis.Notification });
    setNavigatorForTest({});

    const { showAppNotification } = await import("./browserNotifications");
    await expect(
      showAppNotification({
        title: "Turn complete",
        url: "https://example.com/thread-1",
      }),
    ).resolves.toBe(true);

    expect(instances).toHaveLength(1);

    instances[0]?.click();
    expect(focus).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("https://example.com/thread-1");
    expect(instances[0]?.close).toHaveBeenCalledTimes(1);
  });
});
