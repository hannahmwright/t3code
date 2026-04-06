import { describe, expect, it } from "vitest";

import { toServerPushSubscription } from "./notifications";

describe("toServerPushSubscription", () => {
  it("maps a browser PushSubscriptionJSON into the server payload", () => {
    expect(
      toServerPushSubscription({
        endpoint: "https://push.example.test/subscription",
        expirationTime: null,
        keys: {
          p256dh: "p256dh-key",
          auth: "auth-key",
        },
      }),
    ).toEqual({
      endpoint: "https://push.example.test/subscription",
      expirationTime: null,
      keys: {
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
    });
  });

  it("returns null when required encryption keys are missing", () => {
    expect(
      toServerPushSubscription({
        endpoint: "https://push.example.test/subscription",
        expirationTime: null,
        keys: {
          p256dh: "",
          auth: "",
        },
      }),
    ).toBeNull();
  });
});
