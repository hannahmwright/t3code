import { MessageId, ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";

import type { ProjectionThreadMessage } from "../../persistence/Services/ProjectionThreadMessages.ts";
import {
  buildActivitySummaryCommandArgs,
  buildActivitySummaryPrompt,
  normalizeActivitySummary,
} from "./ActivityIndexSummarizer.ts";

const messages: ReadonlyArray<ProjectionThreadMessage> = [
  {
    messageId: MessageId.makeUnsafe("message-1"),
    threadId: ThreadId.makeUnsafe("thread-1"),
    turnId: null,
    role: "user",
    text: "Please investigate why final notifications are firing on every intermediate provider message.",
    isStreaming: false,
    createdAt: "2026-04-28T21:00:00.000Z",
    updatedAt: "2026-04-28T21:00:00.000Z",
  },
  {
    messageId: MessageId.makeUnsafe("message-2"),
    threadId: ThreadId.makeUnsafe("thread-1"),
    turnId: null,
    role: "assistant",
    text: "I found placeholder completion events causing duplicate push notifications and I'm patching the guard logic now.",
    isStreaming: false,
    createdAt: "2026-04-28T21:01:00.000Z",
    updatedAt: "2026-04-28T21:01:00.000Z",
  },
];

it("builds a compact activity-summary prompt from thread context", () => {
  const prompt = buildActivitySummaryPrompt({
    thread: {
      threadId: "thread-1",
      threadName: "Fix notification spam",
      projectId: "project-1",
      projectName: "Beacon",
      workspaceRoot: "/Users/hannahwright/Code/Beacon",
      workspaceName: "Beacon",
      updatedAt: "2026-04-28T21:01:00.000Z",
      branch: null,
      worktreePath: null,
    },
    messages,
  });

  assert.include(prompt, "Project: Beacon");
  assert.include(prompt, "Thread: Fix notification spam");
  assert.include(prompt, "[user] Please investigate why final notifications are firing");
  assert.include(prompt, "[assistant] I found placeholder completion events");
});

it("normalizes Codex summary output into a single short sentence", () => {
  assert.equal(
    normalizeActivitySummary(
      '  "Investigating duplicate final notifications and tightening the push guard so only completed turns trigger alerts."  ',
    ),
    "Investigating duplicate final notifications and tightening the push guard so only completed turns trigger alerts.",
  );
});

it("runs the background summarizer without requiring a trusted git repository", () => {
  assert.deepStrictEqual(buildActivitySummaryCommandArgs("/tmp/activity-summary.txt"), [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--model",
    "gpt-5.5",
    "--config",
    'model_reasoning_effort="low"',
    "--output-last-message",
    "/tmp/activity-summary.txt",
    "-",
  ]);
});
