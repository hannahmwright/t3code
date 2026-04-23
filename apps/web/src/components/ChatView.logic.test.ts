import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildExpiredTerminalContextToastCopy,
  deriveComposerPrimaryActionState,
  deriveComposerSendState,
  shouldResetSendPhase,
} from "./ChatView.logic";

describe("deriveComposerSendState", () => {
  it("treats expired terminal pills as non-sendable content", () => {
    const state = deriveComposerSendState({
      prompt: "\uFFFC",
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("");
    expect(state.sendableTerminalContexts).toEqual([]);
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(false);
  });

  it("keeps text sendable while excluding expired terminal pills", () => {
    const state = deriveComposerSendState({
      prompt: `yoo \uFFFC waddup`,
      imageCount: 0,
      terminalContexts: [
        {
          id: "ctx-expired",
          threadId: ThreadId.makeUnsafe("thread-1"),
          terminalId: "default",
          terminalLabel: "Terminal 1",
          lineStart: 4,
          lineEnd: 4,
          text: "",
          createdAt: "2026-03-17T12:52:29.000Z",
        },
      ],
    });

    expect(state.trimmedPrompt).toBe("yoo  waddup");
    expect(state.expiredTerminalContextCount).toBe(1);
    expect(state.hasSendableContent).toBe(true);
  });
});

describe("buildExpiredTerminalContextToastCopy", () => {
  it("formats clear empty-state guidance", () => {
    expect(buildExpiredTerminalContextToastCopy(1, "empty")).toEqual({
      title: "Expired terminal context won't be sent",
      description: "Remove it or re-add it to include terminal output.",
    });
  });

  it("formats omission guidance for sent messages", () => {
    expect(buildExpiredTerminalContextToastCopy(2, "omitted")).toEqual({
      title: "Expired terminal contexts omitted from message",
      description: "Re-add it if you want that terminal output included.",
    });
  });
});

describe("shouldResetSendPhase", () => {
  it("keeps idle state untouched", () => {
    expect(
      shouldResetSendPhase({
        sendPhase: "idle",
        isTurnRunning: false,
        latestTurnSettled: false,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        hasThreadError: false,
      }),
    ).toBe(false);
  });

  it("resets when the latest turn has already settled", () => {
    expect(
      shouldResetSendPhase({
        sendPhase: "sending-turn",
        isTurnRunning: false,
        latestTurnSettled: true,
        hasPendingApproval: false,
        hasPendingUserInput: false,
        hasThreadError: false,
      }),
    ).toBe(true);
  });
});

describe("deriveComposerPrimaryActionState", () => {
  it("prioritizes pending user input over all other composer actions", () => {
    expect(
      deriveComposerPrimaryActionState({
        hasPendingUserInput: true,
        canInterrupt: true,
        showPlanFollowUpPrompt: true,
      }),
    ).toBe("pending-user-input");
  });

  it("shows interrupt whenever the server marks the thread interruptible", () => {
    expect(
      deriveComposerPrimaryActionState({
        hasPendingUserInput: false,
        canInterrupt: true,
        showPlanFollowUpPrompt: true,
      }),
    ).toBe("interrupt");
  });

  it("falls back to plan follow-up when nothing is interruptible", () => {
    expect(
      deriveComposerPrimaryActionState({
        hasPendingUserInput: false,
        canInterrupt: false,
        showPlanFollowUpPrompt: true,
      }),
    ).toBe("plan-follow-up");
  });
});
