import { describe, expect, it } from "vitest";

import {
  DEFAULT_VAPID_SUBJECT,
  normalizeVapidSubject,
  shouldNotifyForTurnDiffCompletionStatus,
  shouldDeletePushSubscriptionAfterFailure,
  withNormalizedVapidSubject,
} from "./PushNotificationService.ts";

describe("PushNotificationService", () => {
  describe("normalizeVapidSubject", () => {
    it("falls back to the default subject when unset or invalid", () => {
      expect(normalizeVapidSubject(undefined)).toBe(DEFAULT_VAPID_SUBJECT);
      expect(normalizeVapidSubject("")).toBe(DEFAULT_VAPID_SUBJECT);
      expect(normalizeVapidSubject("not-a-url")).toBe(DEFAULT_VAPID_SUBJECT);
      expect(normalizeVapidSubject("ftp://example.com/contact")).toBe(DEFAULT_VAPID_SUBJECT);
    });

    it("replaces localhost-based subjects that Safari rejects", () => {
      expect(normalizeVapidSubject("https://localhost/contact")).toBe(DEFAULT_VAPID_SUBJECT);
      expect(normalizeVapidSubject("https://127.0.0.1/contact")).toBe(DEFAULT_VAPID_SUBJECT);
      expect(normalizeVapidSubject("mailto:t3code@localhost")).toBe(DEFAULT_VAPID_SUBJECT);
    });

    it("preserves valid non-localhost subjects", () => {
      expect(normalizeVapidSubject("mailto:ops@example.com")).toBe("mailto:ops@example.com");
      expect(normalizeVapidSubject("https://t3.thewrighthome.app/contact")).toBe(
        "https://t3.thewrighthome.app/contact",
      );
    });
  });

  describe("withNormalizedVapidSubject", () => {
    it("upgrades persisted configs without changing the keypair", () => {
      expect(
        withNormalizedVapidSubject({
          publicKey: "public-key",
          privateKey: "private-key",
          subject: "mailto:t3code@localhost",
        }),
      ).toEqual({
        publicKey: "public-key",
        privateKey: "private-key",
        subject: DEFAULT_VAPID_SUBJECT,
      });
    });
  });

  describe("shouldDeletePushSubscriptionAfterFailure", () => {
    it("drops subscriptions that are expired or tied to the wrong VAPID key", () => {
      expect(
        shouldDeletePushSubscriptionAfterFailure({
          cause: {
            statusCode: 404,
          },
        }),
      ).toBe(true);
      expect(
        shouldDeletePushSubscriptionAfterFailure({
          cause: {
            statusCode: 400,
            body: JSON.stringify({ reason: "VapidPkHashMismatch" }),
          },
        }),
      ).toBe(true);
      expect(
        shouldDeletePushSubscriptionAfterFailure({
          cause: {
            statusCode: 400,
            body: JSON.stringify({ reason: "BadJwtToken" }),
          },
        }),
      ).toBe(false);
    });
  });

  describe("shouldNotifyForTurnDiffCompletionStatus", () => {
    it("suppresses placeholder turn diff updates", () => {
      expect(shouldNotifyForTurnDiffCompletionStatus("missing")).toBe(false);
      expect(shouldNotifyForTurnDiffCompletionStatus("ready")).toBe(true);
      expect(shouldNotifyForTurnDiffCompletionStatus("error")).toBe(true);
    });
  });
});
