import { describe, expect, it } from "vitest";

import { getPwaInstallState } from "./pwa";

describe("getPwaInstallState", () => {
  it("returns the same snapshot reference when the install state is unchanged", () => {
    const first = getPwaInstallState();
    const second = getPwaInstallState();

    expect(second).toBe(first);
  });
});
