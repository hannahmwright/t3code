import { ProjectId, type ThreadId } from "@t3tools/contracts";
import { type ChatMessage, type Thread } from "../types";
import { randomUUID } from "~/lib/utils";
import { type ComposerImageAttachment, type DraftThreadState } from "../composerDraftStore";
import { Schema } from "effect";
import {
  filterTerminalContextsWithText,
  stripInlineTerminalContextPlaceholders,
  type TerminalContextDraft,
} from "../lib/terminalContext";

export const LAST_INVOKED_SCRIPT_BY_PROJECT_KEY = "t3code:last-invoked-script-by-project";
const WORKTREE_BRANCH_PREFIX = "t3code";
const SIDECHAT_CONTEXT_MAX_CHARS = 12_000;
const SIDECHAT_CONTEXT_MAX_MESSAGES = 16;
const SIDECHAT_MESSAGE_MAX_CHARS = 1_800;

export const LastInvokedScriptByProjectSchema = Schema.Record(ProjectId, Schema.String);

export function buildLocalDraftThread(
  threadId: ThreadId,
  draftThread: DraftThreadState,
  fallbackModel: string,
  error: string | null,
): Thread {
  return {
    id: threadId,
    codexThreadId: null,
    projectId: draftThread.projectId,
    sidechatSourceThreadId: draftThread.sidechatSourceThreadId ?? null,
    title: "New thread",
    model: fallbackModel,
    runtimeMode: draftThread.runtimeMode,
    interactionMode: draftThread.interactionMode,
    session: null,
    messages: [],
    detailsLoaded: true,
    error,
    createdAt: draftThread.createdAt,
    latestTurn: null,
    lastVisitedAt: draftThread.createdAt,
    branch: draftThread.branch,
    worktreePath: draftThread.worktreePath,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
  };
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return;
  }
  URL.revokeObjectURL(previewUrl);
}

export function revokeUserMessagePreviewUrls(message: ChatMessage): void {
  if (message.role !== "user" || !message.attachments) {
    return;
  }
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") {
      continue;
    }
    revokeBlobPreviewUrl(attachment.previewUrl);
  }
}

export function collectUserMessageBlobPreviewUrls(message: ChatMessage): string[] {
  if (message.role !== "user" || !message.attachments) {
    return [];
  }
  const previewUrls: string[] = [];
  for (const attachment of message.attachments) {
    if (attachment.type !== "image") continue;
    if (!attachment.previewUrl || !attachment.previewUrl.startsWith("blob:")) continue;
    previewUrls.push(attachment.previewUrl);
  }
  return previewUrls;
}

export type SendPhase = "idle" | "preparing-worktree" | "sending-turn";
export type ComposerPrimaryActionState =
  | "pending-user-input"
  | "interrupt"
  | "plan-follow-up"
  | "send";

export interface PullRequestDialogState {
  initialReference: string | null;
  key: number;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Could not read image data."));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."));
    });
    reader.readAsDataURL(file);
  });
}

export function buildTemporaryWorktreeBranchName(): string {
  // Keep the 8-hex suffix shape for backend temporary-branch detection.
  const token = randomUUID().slice(0, 8).toLowerCase();
  return `${WORKTREE_BRANCH_PREFIX}/${token}`;
}

function truncateForSidechatContext(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n[truncated]`;
}

export function buildSidechatProviderMessage(input: {
  userMessageText: string;
  sourceThread: {
    title: string;
    messages: ReadonlyArray<Pick<ChatMessage, "role" | "text">>;
  };
}): string | null {
  const sourceMessages = input.sourceThread.messages
    .filter((message) => message.text.trim().length > 0)
    .slice(-SIDECHAT_CONTEXT_MAX_MESSAGES);
  if (sourceMessages.length === 0) {
    return null;
  }

  const contextLines = sourceMessages.map((message) => {
    const role =
      message.role === "assistant" ? "Assistant" : message.role === "user" ? "User" : "System";
    return `${role}: ${truncateForSidechatContext(message.text.trim(), SIDECHAT_MESSAGE_MAX_CHARS)}`;
  });

  const sourceContext = truncateForSidechatContext(
    [`Source chat: ${input.sourceThread.title}`, "", ...contextLines].join("\n"),
    SIDECHAT_CONTEXT_MAX_CHARS,
  );

  return [
    "Use this source chat context as background for this sidechat. The user cannot see this context block, so answer naturally and do not mention that hidden context was attached unless it matters.",
    "",
    "<source_chat_context>",
    sourceContext,
    "</source_chat_context>",
    "",
    "Current user request:",
    input.userMessageText,
  ].join("\n");
}

export function buildAgentReviewPrompt(input: {
  sourceThreadTitle: string;
  assistantMessageText: string;
}): string {
  return [
    `Review this response from "${input.sourceThreadTitle}" and reply with feedback the original agent can act on.`,
    "",
    "Focus on correctness, risks, regressions, missing tests, and the next concrete step. Be concise, but include enough detail for the original agent to continue without guessing.",
    "",
    "<assistant_response_to_review>",
    input.assistantMessageText.trim(),
    "</assistant_response_to_review>",
  ].join("\n");
}

export function buildAgentReviewRelayPrompt(input: {
  reviewThreadTitle: string;
  reviewerMessageText: string;
}): string {
  return [
    `Reviewer feedback from "${input.reviewThreadTitle}":`,
    "",
    input.reviewerMessageText.trim(),
    "",
    "Please respond to this review in the original thread. Address the feedback directly, call out anything you disagree with, and continue the work from here.",
  ].join("\n");
}

export function cloneComposerImageForRetry(
  image: ComposerImageAttachment,
): ComposerImageAttachment {
  if (typeof URL === "undefined" || !image.previewUrl.startsWith("blob:")) {
    return image;
  }
  try {
    return {
      ...image,
      previewUrl: URL.createObjectURL(image.file),
    };
  } catch {
    return image;
  }
}

export function deriveComposerSendState(options: {
  prompt: string;
  imageCount: number;
  terminalContexts: ReadonlyArray<TerminalContextDraft>;
}): {
  trimmedPrompt: string;
  sendableTerminalContexts: TerminalContextDraft[];
  expiredTerminalContextCount: number;
  hasSendableContent: boolean;
} {
  const trimmedPrompt = stripInlineTerminalContextPlaceholders(options.prompt).trim();
  const sendableTerminalContexts = filterTerminalContextsWithText(options.terminalContexts);
  const expiredTerminalContextCount =
    options.terminalContexts.length - sendableTerminalContexts.length;
  return {
    trimmedPrompt,
    sendableTerminalContexts,
    expiredTerminalContextCount,
    hasSendableContent:
      trimmedPrompt.length > 0 || options.imageCount > 0 || sendableTerminalContexts.length > 0,
  };
}

export function buildExpiredTerminalContextToastCopy(
  expiredTerminalContextCount: number,
  variant: "omitted" | "empty",
): { title: string; description: string } {
  const count = Math.max(1, Math.floor(expiredTerminalContextCount));
  const noun = count === 1 ? "Expired terminal context" : "Expired terminal contexts";
  if (variant === "empty") {
    return {
      title: `${noun} won't be sent`,
      description: "Remove it or re-add it to include terminal output.",
    };
  }
  return {
    title: `${noun} omitted from message`,
    description: "Re-add it if you want that terminal output included.",
  };
}

export function shouldResetSendPhase(input: {
  sendPhase: SendPhase;
  isTurnRunning: boolean;
  latestTurnSettled: boolean;
  hasPendingApproval: boolean;
  hasPendingUserInput: boolean;
  hasThreadError: boolean;
}): boolean {
  if (input.sendPhase === "idle") {
    return false;
  }

  return (
    input.isTurnRunning ||
    input.latestTurnSettled ||
    input.hasPendingApproval ||
    input.hasPendingUserInput ||
    input.hasThreadError
  );
}

export function deriveComposerPrimaryActionState(input: {
  hasPendingUserInput: boolean;
  canInterrupt: boolean;
  showPlanFollowUpPrompt: boolean;
}): ComposerPrimaryActionState {
  if (input.hasPendingUserInput) {
    return "pending-user-input";
  }
  if (input.canInterrupt) {
    return "interrupt";
  }
  if (input.showPlanFollowUpPrompt) {
    return "plan-follow-up";
  }
  return "send";
}
