import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import Mime from "@effect/platform-node/Mime";
import type { ThreadId, TurnId } from "@t3tools/contracts";

export const VISUAL_PROOF_ARTIFACTS_ROUTE_PREFIX = "/proof-artifacts";
export const VISUAL_PROOF_API_ROUTE_PREFIX = "/api/visual-proof";

const SAFE_ARTIFACT_ID_PATTERN = /^[a-z0-9_-]+$/i;
const MAX_WAIT_AFTER_LOAD_MS = 8_000;

type VisualProofStatus = "started" | "step-captured" | "completed" | "failed";

export interface VisualProofArtifact {
  id: string;
  kind: "image" | "video";
  mimeType: string;
  byteSize: number;
  filename: string;
  createdAt: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface VisualProofRunPayload {
  runId: string;
  status: VisualProofStatus;
  cwd: string | null;
  title: string;
  summary: string;
  artifacts: VisualProofArtifact[];
  posterArtifactId: string | null;
  videoArtifactId: string | null;
  stepCount: number;
  updatedAt: string;
}

export interface VisualProofRunState {
  runId: string;
  token: string;
  threadId: ThreadId;
  turnId: TurnId | null;
  cwd: string | null;
  title: string;
  summary: string;
  artifacts: VisualProofArtifact[];
  status: VisualProofStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VisualProofRequest {
  runId: string;
  token: string;
  threadId: ThreadId;
  cwd: string | null;
  title: string;
  summary: string;
}

export interface VisualProofCaptureInput {
  token: string;
  url: string;
  title?: string;
  summary?: string;
  includeVideo?: boolean;
  waitAfterLoadMs?: number;
}

export interface VisualProofCompleteInput {
  token: string;
  title?: string;
  summary?: string;
}

export interface VisualProofFailInput {
  token: string;
  summary?: string;
}

const runs = new Map<string, VisualProofRunState>();

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`.toLowerCase();
}

function sanitizeFilenameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return normalized || "visual-proof";
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "video/webm":
      return ".webm";
    case "video/mp4":
      return ".mp4";
    default:
      return ".bin";
  }
}

function supportedArtifactExtensions(): readonly string[] {
  return [".png", ".jpg", ".jpeg", ".webp", ".webm", ".mp4"];
}

export function createVisualProofRunRequest(input: {
  threadId: ThreadId;
  cwd: string | null;
  title?: string;
  summary?: string;
}): VisualProofRequest {
  const runId = makeId("proof");
  const token = crypto.randomBytes(24).toString("base64url");
  const stamp = nowIso();
  const state: VisualProofRunState = {
    runId,
    token,
    threadId: input.threadId,
    turnId: null,
    cwd: input.cwd,
    title: input.title ?? "Visual proof",
    summary: input.summary ?? "Visual proof capture is ready.",
    artifacts: [],
    status: "started",
    createdAt: stamp,
    updatedAt: stamp,
  };
  runs.set(runId, state);
  return {
    runId,
    token,
    threadId: input.threadId,
    cwd: input.cwd,
    title: state.title,
    summary: state.summary,
  };
}

export function bindVisualProofRunToTurn(runId: string, turnId: TurnId): void {
  const run = runs.get(runId);
  if (!run) return;
  run.turnId = turnId;
  run.updatedAt = nowIso();
}

export function getVisualProofRun(runId: string): VisualProofRunState | null {
  return runs.get(runId) ?? null;
}

export function buildVisualProofRunPayload(run: VisualProofRunState): VisualProofRunPayload {
  const poster =
    run.artifacts.find((artifact) => artifact.kind === "image") ?? run.artifacts[0] ?? null;
  const video = run.artifacts.find((artifact) => artifact.kind === "video") ?? null;
  return {
    runId: run.runId,
    status: run.status,
    cwd: run.cwd,
    title: run.title,
    summary: run.summary,
    artifacts: [...run.artifacts],
    posterArtifactId: poster?.id ?? null,
    videoArtifactId: video?.id ?? null,
    stepCount: run.artifacts.filter((artifact) => artifact.kind === "image").length,
    updatedAt: run.updatedAt,
  };
}

function requireRun(runId: string, token: string): VisualProofRunState {
  const run = runs.get(runId);
  if (!run || run.token !== token) {
    throw new Error("Invalid visual proof run or token.");
  }
  return run;
}

export function resolveVisualProofArtifactPath(input: {
  visualProofArtifactsDir: string;
  artifactId: string;
}): string | null {
  if (!SAFE_ARTIFACT_ID_PATTERN.test(input.artifactId) || input.artifactId.includes(".")) {
    return null;
  }
  const root = path.resolve(input.visualProofArtifactsDir);
  for (const extension of supportedArtifactExtensions()) {
    const candidate = path.resolve(path.join(root, `${input.artifactId}${extension}`));
    if (!candidate.startsWith(`${root}${path.sep}`)) {
      continue;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function persistArtifact(input: {
  visualProofArtifactsDir: string;
  run: VisualProofRunState;
  kind: VisualProofArtifact["kind"];
  mimeType: string;
  sourcePath: string;
  title: string;
  width?: number;
  height?: number;
  durationMs?: number;
}): Promise<VisualProofArtifact> {
  await fsp.mkdir(input.visualProofArtifactsDir, { recursive: true });
  const id = makeId(`${input.run.runId}-${input.kind}`);
  const extension = extensionForMimeType(input.mimeType);
  const filename = `${sanitizeFilenameSegment(input.title)}${extension}`;
  const storedPath = path.join(input.visualProofArtifactsDir, `${id}${extension}`);
  await fsp.copyFile(input.sourcePath, storedPath);
  const stat = await fsp.stat(storedPath);
  const artifact: VisualProofArtifact = {
    id,
    kind: input.kind,
    mimeType: input.mimeType,
    byteSize: stat.size,
    filename,
    createdAt: nowIso(),
    ...(input.width !== undefined ? { width: input.width } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
  input.run.artifacts.push(artifact);
  input.run.updatedAt = artifact.createdAt;
  return artifact;
}

function normalizeCaptureUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new Error("Capture URL is required.");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Visual proof capture only supports http and https URLs.");
  }
  return parsed.toString();
}

export async function captureVisualProofStep(input: {
  visualProofArtifactsDir: string;
  runId: string;
  request: VisualProofCaptureInput;
}): Promise<VisualProofRunState> {
  const run = requireRun(input.runId, input.request.token);
  const url = normalizeCaptureUrl(input.request.url);
  const title = input.request.title?.trim() || run.title;
  const summary = input.request.summary?.trim() || `Captured ${url}`;
  const waitAfterLoadMs = Math.min(
    Math.max(input.request.waitAfterLoadMs ?? 1_000, 0),
    MAX_WAIT_AFTER_LOAD_MS,
  );
  await fsp.mkdir(input.visualProofArtifactsDir, { recursive: true });
  const tempDir = await fsp.mkdtemp(path.join(input.visualProofArtifactsDir, ".capture-"));
  let context: import("playwright").BrowserContext | null = null;
  try {
    const { chromium } = await import("playwright");
    context = await chromium.launchPersistentContext(path.join(tempDir, "profile"), {
      headless: true,
      viewport: { width: 1280, height: 720 },
      ...(input.request.includeVideo
        ? {
            recordVideo: {
              dir: path.join(tempDir, "videos"),
              size: { width: 1280, height: 720 },
            },
          }
        : {}),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (waitAfterLoadMs > 0) {
      await page.waitForTimeout(waitAfterLoadMs);
    }
    const screenshotPath = path.join(tempDir, "proof.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await persistArtifact({
      visualProofArtifactsDir: input.visualProofArtifactsDir,
      run,
      kind: "image",
      mimeType: "image/png",
      sourcePath: screenshotPath,
      title,
      width: 1280,
      height: 720,
    });

    if (input.request.includeVideo) {
      if (waitAfterLoadMs < 1_500) {
        await page.waitForTimeout(1_500 - waitAfterLoadMs);
      }
      const video = page.video();
      await page.close();
      if (video) {
        const videoPath = path.join(tempDir, "proof.webm");
        await video.saveAs(videoPath);
        await persistArtifact({
          visualProofArtifactsDir: input.visualProofArtifactsDir,
          run,
          kind: "video",
          mimeType: "video/webm",
          sourcePath: videoPath,
          title,
        });
      }
    } else {
      await page.close();
    }

    run.status = "step-captured";
    run.title = title;
    run.summary = summary;
    run.updatedAt = nowIso();
    return run;
  } finally {
    await context?.close().catch(() => undefined);
    await fsp.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function completeVisualProofRun(input: {
  runId: string;
  request: VisualProofCompleteInput;
}): VisualProofRunState {
  const run = requireRun(input.runId, input.request.token);
  run.title = input.request.title?.trim() || run.title;
  run.summary =
    input.request.summary?.trim() ||
    (run.artifacts.length > 0 ? "Visual proof completed." : "Visual proof failed.");
  run.status = run.artifacts.length > 0 ? "completed" : "failed";
  run.updatedAt = nowIso();
  return run;
}

export function failVisualProofRun(input: {
  runId: string;
  request: VisualProofFailInput;
}): VisualProofRunState {
  const run = requireRun(input.runId, input.request.token);
  run.status = "failed";
  run.summary = input.request.summary?.trim() || "Visual proof failed.";
  run.updatedAt = nowIso();
  return run;
}

export function failUnfinishedVisualProofRunsForTurn(input: {
  threadId: ThreadId;
  turnId: TurnId;
  summary: string;
}): VisualProofRunState[] {
  const failedRuns: VisualProofRunState[] = [];
  for (const run of runs.values()) {
    if (run.threadId !== input.threadId || run.turnId !== input.turnId) {
      continue;
    }
    if (run.status === "completed" || run.status === "failed" || run.artifacts.length > 0) {
      continue;
    }
    run.status = "failed";
    run.summary = input.summary;
    run.updatedAt = nowIso();
    failedRuns.push(run);
  }
  return failedRuns;
}

export function shouldEnableVisualProofForPrompt(prompt: string): boolean {
  return parseVisualProofPrompt(prompt) !== null;
}

export function parseVisualProofPrompt(prompt: string): string | null {
  const match = /^\/proof(?:\s+([\s\S]*))?$/i.exec(prompt.trim());
  if (!match) return null;
  const proofPrompt = (match[1] ?? "").trim();
  return proofPrompt.length > 0
    ? proofPrompt
    : "Capture visual proof for the current work before replying.";
}

export function buildVisualProofPromptInstructions(input: {
  baseUrl: string;
  runId: string;
  token: string;
}): string {
  const captureUrl = `${input.baseUrl}${VISUAL_PROOF_API_ROUTE_PREFIX}/${input.runId}/capture`;
  const completeUrl = `${input.baseUrl}${VISUAL_PROOF_API_ROUTE_PREFIX}/${input.runId}/complete`;
  const failUrl = `${input.baseUrl}${VISUAL_PROOF_API_ROUTE_PREFIX}/${input.runId}/fail`;
  return `

---

# T3 Visual Proof Enabled

The user asked for proof, a demo, screenshots, video, or validation. Before your final answer, capture local browser proof through T3 so it appears natively in chat.

Use this helper after the app or website is running:

\`\`\`bash
curl -sS -X POST "${captureUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${input.token}","url":"http://localhost:3000","title":"Visual proof","summary":"Captured the working UI.","includeVideo":true}'
\`\`\`

Replace the URL with the real local URL you verified. When proof is captured successfully, finish it:

\`\`\`bash
curl -sS -X POST "${completeUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${input.token}","summary":"Visual proof completed."}'
\`\`\`

If the workflow cannot be demonstrated in a browser, mark proof failed instead of pretending it succeeded:

\`\`\`bash
curl -sS -X POST "${failUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"token":"${input.token}","summary":"Brief reason proof could not be captured."}'
\`\`\`

Do not paste local screenshot or video paths in the final answer. T3 will render the proof media in chat.`;
}

export function serveVisualProofArtifact(input: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  visualProofArtifactsDir: string;
  artifactId: string;
}): boolean {
  const filePath = resolveVisualProofArtifactPath({
    visualProofArtifactsDir: input.visualProofArtifactsDir,
    artifactId: input.artifactId,
  });
  if (!filePath) {
    return false;
  }
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat?.isFile()) {
    return false;
  }

  const contentType = Mime.getType(filePath) ?? "application/octet-stream";
  const range = input.req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (Number.isInteger(start) && Number.isInteger(end) && start <= end && end < stat.size) {
        input.res.writeHead(206, {
          "Content-Type": contentType,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        fs.createReadStream(filePath, { start, end }).pipe(input.res);
        return true;
      }
    }
  }

  input.res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": String(stat.size),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable",
  });
  fs.createReadStream(filePath).pipe(input.res);
  return true;
}
