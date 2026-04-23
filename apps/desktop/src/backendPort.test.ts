import { describe, expect, it } from "vitest";
import { DEFAULT_LOCAL_SERVER_PORT } from "@t3tools/shared/serverDefaults";

import { resolveDesktopBackendPort } from "./backendPort";

describe("resolveDesktopBackendPort", () => {
  it("defaults to the shared local server port", () => {
    expect(resolveDesktopBackendPort(undefined)).toBe(DEFAULT_LOCAL_SERVER_PORT);
    expect(resolveDesktopBackendPort("")).toBe(DEFAULT_LOCAL_SERVER_PORT);
    expect(resolveDesktopBackendPort("   ")).toBe(DEFAULT_LOCAL_SERVER_PORT);
  });

  it("accepts a valid explicit port override", () => {
    expect(resolveDesktopBackendPort("49152")).toBe(49152);
  });

  it("ignores invalid port overrides", () => {
    expect(resolveDesktopBackendPort("abc")).toBe(DEFAULT_LOCAL_SERVER_PORT);
    expect(resolveDesktopBackendPort("0")).toBe(DEFAULT_LOCAL_SERVER_PORT);
    expect(resolveDesktopBackendPort("70000")).toBe(DEFAULT_LOCAL_SERVER_PORT);
  });
});
