import { TextEncoder } from "node:util";
import { randomUUID } from "node:crypto";

import { DEFAULT_MODEL_BY_PROVIDER, ThreadId } from "@t3tools/contracts";
import { Effect, FileSystem, Layer, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { ServerConfig } from "../../config.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import {
  ProjectionThreadMessageRepository,
  type ProjectionThreadMessage,
} from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ActivityIndexExportLive } from "./ActivityIndexExport.ts";
import { ActivityIndexExport } from "../Services/ActivityIndexExport.ts";
import { selectThreadsNeedingActivitySummary, type ActivityIndexThreadEntry } from "../document.ts";

const ACTIVITY_SUMMARY_INTERVAL = "15 minutes";
const ACTIVITY_SUMMARY_MAX_THREADS_PER_PASS = 5;
const ACTIVITY_SUMMARY_MAX_MESSAGES = 8;
const ACTIVITY_SUMMARY_MAX_MESSAGE_CHARS = 700;
const ACTIVITY_SUMMARIZER_MODEL = DEFAULT_MODEL_BY_PROVIDER.codex;
const ACTIVITY_SUMMARIZER_REASONING_EFFORT = "low";

export function buildActivitySummaryCommandArgs(outputPath: string): string[] {
  return [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--model",
    ACTIVITY_SUMMARIZER_MODEL,
    "--config",
    `model_reasoning_effort="${ACTIVITY_SUMMARIZER_REASONING_EFFORT}"`,
    "--output-last-message",
    outputPath,
    "-",
  ];
}

function limitSection(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars).trimEnd()}...`;
}

export function normalizeActivitySummary(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .slice(0, 240)
    .trim();
}

export function selectMessagesForActivitySummary(
  messages: ReadonlyArray<ProjectionThreadMessage>,
): ReadonlyArray<ProjectionThreadMessage> {
  return messages
    .filter(
      (message) =>
        message.role !== "system" && !message.isStreaming && message.text.trim().length > 0,
    )
    .slice(-ACTIVITY_SUMMARY_MAX_MESSAGES);
}

export function buildActivitySummaryPrompt(input: {
  readonly thread: ActivityIndexThreadEntry;
  readonly messages: ReadonlyArray<ProjectionThreadMessage>;
}): string {
  const messageLines = selectMessagesForActivitySummary(input.messages).map(
    (message) =>
      `[${message.role}] ${limitSection(message.text.trim(), ACTIVITY_SUMMARY_MAX_MESSAGE_CHARS)}`,
  );

  return [
    "Write one brief plain-text sentence summarizing the recent coding work in this thread.",
    "Keep it under 28 words. No markdown, no quotes, no bullet points.",
    "Focus on the concrete work being done, not the fact that a conversation happened.",
    "",
    `Project: ${input.thread.projectName}`,
    `Thread: ${input.thread.threadName}`,
    `Workspace: ${input.thread.workspaceName}`,
    "",
    "Recent messages (oldest to newest):",
    ...messageLines,
  ].join("\n");
}

const makeActivityIndexSummarizer = Effect.gen(function* () {
  const activityIndexExport = yield* ActivityIndexExport;
  const projectionThreadMessageRepository = yield* ProjectionThreadMessageRepository;
  const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const { cwd: serverCwd } = yield* ServerConfig;

  const tempDir = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "/tmp";

  const readStreamAsString = <E>(stream: Stream.Stream<Uint8Array, E>) =>
    Effect.gen(function* () {
      let text = "";
      yield* Stream.runForEach(stream, (chunk) =>
        Effect.sync(() => {
          text += Buffer.from(chunk).toString("utf8");
        }),
      );
      return text;
    });

  const safeUnlink = (filePath: string): Effect.Effect<void, never> =>
    fileSystem.remove(filePath).pipe(Effect.catch(() => Effect.void));

  const resolveSummaryCwd = (thread: ActivityIndexThreadEntry) =>
    Effect.gen(function* () {
      for (const candidate of [thread.worktreePath, thread.workspaceRoot, serverCwd]) {
        if (!candidate) {
          continue;
        }

        const stat = yield* fileSystem
          .stat(candidate)
          .pipe(Effect.catch(() => Effect.succeed(null)));
        if (stat && stat.type === "Directory") {
          return candidate;
        }
      }

      return serverCwd;
    });

  const runCodexSummary = (input: { readonly cwd: string; readonly prompt: string }) =>
    Effect.gen(function* () {
      const outputPath = path.join(
        tempDir,
        `t3code-activity-summary-${process.pid}-${randomUUID()}.txt`,
      );

      return yield* Effect.gen(function* () {
        const command = ChildProcess.make("codex", buildActivitySummaryCommandArgs(outputPath), {
          cwd: input.cwd,
          shell: process.platform === "win32",
          stdin: {
            stream: Stream.make(new TextEncoder().encode(input.prompt)),
          },
        });

        const child = yield* childProcessSpawner.spawn(command);
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [
            readStreamAsString(child.stdout),
            readStreamAsString(child.stderr),
            child.exitCode.pipe(Effect.map((value) => Number(value))),
          ],
          { concurrency: "unbounded" },
        );

        if (exitCode !== 0) {
          throw new Error(
            stderr.trim() || stdout.trim() || `Codex activity summary failed with ${exitCode}.`,
          );
        }

        const outputText = yield* fileSystem
          .readFileString(outputPath)
          .pipe(Effect.catch(() => Effect.succeed(stdout)));
        return normalizeActivitySummary(outputText);
      }).pipe(Effect.ensuring(safeUnlink(outputPath)));
    });

  const summarizeThread = (thread: ActivityIndexThreadEntry) =>
    Effect.gen(function* () {
      const messages = yield* projectionThreadMessageRepository.listByThreadId({
        threadId: ThreadId.makeUnsafe(thread.threadId),
      });
      const selectedMessages = selectMessagesForActivitySummary(messages);
      if (selectedMessages.length === 0) {
        return false;
      }

      const prompt = buildActivitySummaryPrompt({
        thread,
        messages: selectedMessages,
      });
      const summaryCwd = yield* resolveSummaryCwd(thread);
      const activitySummary = yield* runCodexSummary({
        cwd: summaryCwd,
        prompt,
      });
      if (activitySummary.length === 0) {
        return false;
      }

      return yield* activityIndexExport.upsertThreadSummary({
        threadId: thread.threadId,
        activitySummary,
        summaryUpdatedAt: new Date().toISOString(),
        sourceUpdatedAt: thread.updatedAt,
      });
    });

  const runSummaryPass = Effect.gen(function* () {
    const document = yield* activityIndexExport.readDocument();
    if (!document) {
      return;
    }

    const threads = selectThreadsNeedingActivitySummary(
      document,
      ACTIVITY_SUMMARY_MAX_THREADS_PER_PASS,
    );
    for (const thread of threads) {
      yield* summarizeThread(thread).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("failed to summarize thread activity", {
            threadId: thread.threadId,
            threadName: thread.threadName,
            cause,
          }),
        ),
      );
    }
  });

  const safeRunSummaryPass = runSummaryPass.pipe(
    Effect.catch((cause) =>
      Effect.logWarning("activity summary pass failed", {
        cause,
      }),
    ),
  );

  yield* Effect.forever(
    Effect.sleep(ACTIVITY_SUMMARY_INTERVAL).pipe(Effect.flatMap(() => safeRunSummaryPass)),
  ).pipe(Effect.forkScoped);
});

export const ActivityIndexSummarizerLive = Layer.effectDiscard(makeActivityIndexSummarizer).pipe(
  Layer.provideMerge(ActivityIndexExportLive),
  Layer.provideMerge(ProjectionThreadMessageRepositoryLive),
);
