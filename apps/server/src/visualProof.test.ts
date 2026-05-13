import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ThreadId, TurnId } from "@t3tools/contracts";
import { afterEach, describe, expect, it } from "vitest";

import {
  bindVisualProofRunToTurn,
  buildVisualProofPromptInstructions,
  buildVisualProofRunPayload,
  createVisualProofRunRequest,
  getVisualProofRun,
  resolveVisualProofArtifactPath,
  shouldEnableVisualProofForPrompt,
} from "./visualProof";

describe("visualProof", () => {
  const tempDirs = new Set<string>();

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t3code-proof-"));
    tempDirs.add(dir);
    return dir;
  }

  it("resolves proof artifacts by safe id only", () => {
    const root = makeTempDir();
    fs.writeFileSync(path.join(root, "proof-safe.png"), "png");

    expect(
      resolveVisualProofArtifactPath({
        visualProofArtifactsDir: root,
        artifactId: "proof-safe",
      }),
    ).toBe(path.join(root, "proof-safe.png"));
    expect(
      resolveVisualProofArtifactPath({
        visualProofArtifactsDir: root,
        artifactId: "../proof-safe",
      }),
    ).toBeNull();
    expect(
      resolveVisualProofArtifactPath({
        visualProofArtifactsDir: root,
        artifactId: "proof-safe.png",
      }),
    ).toBeNull();
  });

  it("tracks a proof run and binds it to the provider turn", () => {
    const request = createVisualProofRunRequest({
      threadId: ThreadId.makeUnsafe("thread-proof"),
      cwd: "/tmp/project",
    });
    bindVisualProofRunToTurn(request.runId, TurnId.makeUnsafe("turn-proof"));

    const run = getVisualProofRun(request.runId);
    expect(run?.turnId).toBe("turn-proof");
    expect(run && buildVisualProofRunPayload(run)).toMatchObject({
      runId: request.runId,
      status: "started",
      cwd: "/tmp/project",
      stepCount: 0,
    });
  });

  it("detects proof requests and builds helper instructions", () => {
    expect(shouldEnableVisualProofForPrompt("please show me a screenshot of it working")).toBe(
      true,
    );
    expect(shouldEnableVisualProofForPrompt("rename this variable")).toBe(false);
    expect(
      buildVisualProofPromptInstructions({
        baseUrl: "http://127.0.0.1:3000",
        runId: "proof-1",
        token: "secret",
      }),
    ).toContain("/api/visual-proof/proof-1/capture");
  });
});
