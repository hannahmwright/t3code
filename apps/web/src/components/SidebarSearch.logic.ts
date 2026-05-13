import type { ProviderKind } from "@t3tools/contracts";
import type { ProjectId, ThreadId } from "@t3tools/contracts";

export interface SidebarSearchThread {
  id: ThreadId;
  title: string;
  projectId: ProjectId | null;
  projectName: string;
  provider: ProviderKind;
  createdAt: string;
  updatedAt?: string | undefined;
  messages: readonly {
    text: string;
  }[];
}

export interface SidebarSearchThreadMatch {
  id: ThreadId;
  thread: SidebarSearchThread;
  matchKind: "message" | "project" | "title";
  snippet: string | null;
  messageMatchCount: number;
}

function normalizeText(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function normalizeDisplayText(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ");
}

function tokenizeQuery(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function truncateSnippet(value: string, startIndex: number, queryLength: number): string {
  const maxLength = 88;
  const safeStartIndex = Math.max(0, startIndex);
  if (value.length <= maxLength) {
    return value;
  }

  const contextBefore = Math.min(28, safeStartIndex);
  const queryCenter = safeStartIndex + Math.max(queryLength, 1) / 2;
  const desiredStart = Math.max(0, Math.round(queryCenter - maxLength / 2) - contextBefore);
  const boundedStart = Math.min(desiredStart, Math.max(0, value.length - maxLength));
  const boundedEnd = Math.min(value.length, boundedStart + maxLength);
  const prefix = boundedStart > 0 ? "..." : "";
  const suffix = boundedEnd < value.length ? "..." : "";
  return `${prefix}${value.slice(boundedStart, boundedEnd).trim()}${suffix}`;
}

function buildMessageSnippet(
  messageText: string,
  query: string,
  queryTokens: readonly string[],
): string {
  const displayMessage = normalizeDisplayText(messageText);
  if (!displayMessage) return "";

  const normalizedMessage = displayMessage.toLowerCase();
  const phraseIndex = normalizedMessage.indexOf(query);
  if (phraseIndex >= 0) {
    return truncateSnippet(displayMessage, phraseIndex, query.length);
  }

  let earliestTokenIndex = Number.POSITIVE_INFINITY;
  let matchedToken = "";
  for (const token of queryTokens) {
    const tokenIndex = normalizedMessage.indexOf(token);
    if (tokenIndex >= 0 && tokenIndex < earliestTokenIndex) {
      earliestTokenIndex = tokenIndex;
      matchedToken = token;
    }
  }

  if (!Number.isFinite(earliestTokenIndex)) {
    return truncateSnippet(displayMessage, 0, 0);
  }

  return truncateSnippet(displayMessage, earliestTokenIndex, matchedToken.length);
}

function scoreMessage(
  messages: SidebarSearchThread["messages"],
  query: string,
  queryTokens: readonly string[],
): {
  messageMatchCount: number;
  score: number | null;
  snippet: string | null;
} {
  let bestScore: number | null = null;
  let bestSnippet: string | null = null;
  let matchCount = 0;

  for (const message of messages) {
    const normalizedMessage = normalizeText(message.text);
    if (!normalizedMessage) continue;

    let score: number | null = null;
    if (normalizedMessage === query) {
      score = 165;
    } else if (normalizedMessage.startsWith(query)) {
      score = 155;
    } else if (normalizedMessage.includes(query)) {
      score = 145;
    } else if (
      queryTokens.length > 1 &&
      queryTokens.every((token) => normalizedMessage.includes(token))
    ) {
      score = 132;
    }

    if (score === null) continue;
    matchCount += 1;
    if (bestScore === null || score > bestScore) {
      bestScore = score;
      bestSnippet = buildMessageSnippet(message.text, query, queryTokens);
    }
  }

  return {
    messageMatchCount: matchCount,
    score: bestScore,
    snippet: bestSnippet,
  };
}

function scoreThread(thread: SidebarSearchThread, query: string, queryTokens: readonly string[]) {
  const title = normalizeText(thread.title);
  const projectName = normalizeText(thread.projectName);

  if (title === query) return { kind: "title" as const, score: 220, snippet: null, count: 0 };
  if (title.startsWith(query))
    return { kind: "title" as const, score: 205, snippet: null, count: 0 };
  if (title.includes(query)) return { kind: "title" as const, score: 180, snippet: null, count: 0 };
  if (projectName === query)
    return { kind: "project" as const, score: 150, snippet: null, count: 0 };
  if (projectName.startsWith(query))
    return { kind: "project" as const, score: 130, snippet: null, count: 0 };
  if (projectName.includes(query))
    return { kind: "project" as const, score: 115, snippet: null, count: 0 };

  const messageMatch = scoreMessage(thread.messages, query, queryTokens);
  if (messageMatch.score !== null) {
    return {
      kind: "message" as const,
      score: messageMatch.score,
      snippet: messageMatch.snippet,
      count: messageMatch.messageMatchCount,
    };
  }

  return null;
}

export function matchSidebarSearchThreads(
  threads: readonly SidebarSearchThread[],
  rawQuery: string,
): SidebarSearchThreadMatch[] {
  const query = normalizeText(rawQuery);
  if (!query) return [];
  const queryTokens = tokenizeQuery(query);

  return threads
    .map((thread, index) => {
      const score = scoreThread(thread, query, queryTokens);
      return { thread, index, score };
    })
    .filter((entry): entry is typeof entry & { score: NonNullable<typeof entry.score> } =>
      Boolean(entry.score),
    )
    .toSorted((left, right) => {
      if (left.score.score !== right.score.score) return right.score.score - left.score.score;
      const leftUpdatedAt = left.thread.updatedAt ?? left.thread.createdAt;
      const rightUpdatedAt = right.thread.updatedAt ?? right.thread.createdAt;
      const byUpdated = rightUpdatedAt.localeCompare(leftUpdatedAt);
      if (byUpdated !== 0) return byUpdated;
      return left.index - right.index;
    })
    .map(({ thread, score }) => ({
      id: thread.id,
      thread,
      matchKind: score.kind,
      snippet: score.snippet,
      messageMatchCount: score.count,
    }));
}
