import { describe, expect, it } from "vitest";

import {
  shouldBypassAppAuthForDesktopShell,
  shouldWaitForDesktopAuthService,
} from "./appAuth";

describe("shouldBypassAppAuthForDesktopShell", () => {
  it("bypasses app auth inside the packaged desktop shell", () => {
    expect(shouldBypassAppAuthForDesktopShell(true, "t3:")).toBe(true);
  });

  it("does not bypass app auth in a normal browser", () => {
    expect(shouldBypassAppAuthForDesktopShell(false, "https:")).toBe(false);
  });

  it("does not bypass app auth in Electron dev served over http", () => {
    expect(shouldBypassAppAuthForDesktopShell(true, "http:")).toBe(false);
  });
});

describe("shouldWaitForDesktopAuthService", () => {
  it("waits for the auth service in desktop when the initial probe is still unreachable", () => {
    expect(
      shouldWaitForDesktopAuthService(
        {
          ready: true,
          reachable: false,
        },
        true,
      ),
    ).toBe(true);
  });

  it("does not block browser sign-in flows on an unreachable auth probe", () => {
    expect(
      shouldWaitForDesktopAuthService(
        {
          ready: true,
          reachable: false,
        },
        false,
      ),
    ).toBe(false);
  });

  it("stops waiting once the desktop auth service is reachable", () => {
    expect(
      shouldWaitForDesktopAuthService(
        {
          ready: true,
          reachable: true,
        },
        true,
      ),
    ).toBe(false);
  });

  it("does not start retrying before the first auth probe completes", () => {
    expect(
      shouldWaitForDesktopAuthService(
        {
          ready: false,
          reachable: false,
        },
        true,
      ),
    ).toBe(false);
  });
});
