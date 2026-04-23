import { describe, expect, it } from "vitest";

import {
  buildTurnCompletionNotificationBody,
  getTurnCompletionNotificationPreview,
} from "./notifications";

describe("notifications", () => {
  it("extracts the latest completed assistant message preview for a turn", () => {
    expect(
      getTurnCompletionNotificationPreview({
        turnId: "turn-1",
        messages: [
          {
            role: "assistant",
            text: "earlier reply",
            turnId: "turn-1",
            streaming: false,
          },
          {
            role: "assistant",
            text: "Latest final reply",
            turnId: "turn-1",
            streaming: false,
          },
        ],
      }),
    ).toBe("Latest final reply");
  });

  it("normalizes whitespace and truncates long previews", () => {
    expect(
      getTurnCompletionNotificationPreview({
        turnId: "turn-1",
        maxLength: 20,
        messages: [
          {
            role: "assistant",
            text: "Hello\n\nthere from the final answer",
            turnId: "turn-1",
            streaming: false,
          },
        ],
      }),
    ).toBe("Hello there from...");
  });

  it("builds a notification body with project name and preview", () => {
    expect(
      buildTurnCompletionNotificationBody({
        projectName: "Workspace",
        messagePreview: "Done. Tests are passing.",
      }),
    ).toBe("Workspace • Done. Tests are passing.");
  });

  it("falls back to detail or the default body when no preview exists", () => {
    expect(
      buildTurnCompletionNotificationBody({
        projectName: "Workspace",
        detail: "Worked for 2m 58s",
      }),
    ).toBe("Workspace • Worked for 2m 58s");
    expect(buildTurnCompletionNotificationBody({})).toBe("A turn finished.");
  });
});
