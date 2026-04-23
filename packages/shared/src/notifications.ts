interface TurnCompletionNotificationMessageLike {
  readonly role: "user" | "assistant" | "system";
  readonly text: string;
  readonly turnId?: string | null;
  readonly streaming: boolean;
}

const NOTIFICATION_DEFAULT_BODY = "A turn finished.";
const NOTIFICATION_PREVIEW_MAX_LENGTH = 140;

function normalizeNotificationText(text: string | null | undefined): string | null {
  const normalized = (text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function truncateNotificationPreview(
  text: string,
  maxLength = NOTIFICATION_PREVIEW_MAX_LENGTH,
): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function getTurnCompletionNotificationPreview(input: {
  readonly messages: ReadonlyArray<TurnCompletionNotificationMessageLike>;
  readonly turnId: string | null | undefined;
  readonly maxLength?: number;
}): string | null {
  const relevantMessages = input.messages.toReversed().filter((message) => {
    if (message.role !== "assistant") {
      return false;
    }
    if (input.turnId) {
      return message.turnId === input.turnId;
    }
    return true;
  });

  let streamingFallback: string | null = null;
  for (const message of relevantMessages) {
    const normalized = normalizeNotificationText(message.text);
    if (!normalized) {
      continue;
    }
    if (!message.streaming) {
      return truncateNotificationPreview(normalized, input.maxLength);
    }
    if (streamingFallback === null) {
      streamingFallback = normalized;
    }
  }

  return streamingFallback === null
    ? null
    : truncateNotificationPreview(streamingFallback, input.maxLength);
}

export function buildTurnCompletionNotificationBody(input: {
  readonly projectName?: string | null;
  readonly messagePreview?: string | null;
  readonly detail?: string | null;
}): string {
  const projectName = normalizeNotificationText(input.projectName);
  const messagePreview = normalizeNotificationText(input.messagePreview);
  const detail = normalizeNotificationText(input.detail);
  const parts = [
    ...(projectName ? [projectName] : []),
    ...(messagePreview ? [messagePreview] : detail ? [detail] : []),
  ];

  return parts.join(" • ") || NOTIFICATION_DEFAULT_BODY;
}
