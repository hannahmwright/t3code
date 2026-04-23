import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { access, constants } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import desktopPackageJson from "../package.json" with { type: "json" };

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..");
const repoRoot = resolve(desktopDir, "../..");
const smokePort = Number(process.env.T3CODE_SMOKE_PORT ?? "40773");
const keepTemp = process.env.T3CODE_SMOKE_KEEP_TEMP === "1";
const productName = desktopPackageJson.productName;
const releaseZipPath =
  process.env.T3CODE_SMOKE_ZIP ??
  join(repoRoot, "release", `T3-Code-${desktopPackageJson.version}-${process.arch}.zip`);
const tempRoot = mkdtempSync(join(tmpdir(), "t3-desktop-smoke-"));
const smokeHome = join(tempRoot, "home");
const extractedRoot = join(tempRoot, "app");
const desktopLogPath = join(smokeHome, "userdata", "logs", "desktop-main.log");

function cleanup() {
  if (!keepTemp) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitForFile(filePath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await access(filePath, constants.F_OK);
      return true;
    } catch {
      await sleep(250);
    }
  }
  return false;
}

async function waitForHealthySession(timeoutMs) {
  const startedAt = Date.now();
  let lastError = "No response received.";
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${smokePort}/api/auth/session`);
      if (response.ok) {
        const payload = await response.json();
        if (payload?.auth?.enabled === true) {
          return payload;
        }
        lastError = `Unexpected payload: ${JSON.stringify(payload)}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for /api/auth/session on port ${smokePort}: ${lastError}`);
}

function assertCommandOk(result, label) {
  if (result.status === 0) {
    return;
  }
  const stderr = result.stderr?.toString().trim();
  throw new Error(`${label} failed${stderr ? `: ${stderr}` : "."}`);
}

function resolvePackagedExecutable(appRoot) {
  if (process.platform === "darwin") {
    return join(appRoot, `${productName}.app`, "Contents", "MacOS", productName);
  }
  throw new Error(`Packaged smoke test is not implemented for ${process.platform}.`);
}

async function main() {
  console.log(`\nRunning packaged desktop smoke test from ${releaseZipPath}`);

  const unzipProbe = spawnSync("unzip", ["-v"], { stdio: "ignore" });
  if (unzipProbe.status !== 0) {
    throw new Error("The `unzip` command is required for the packaged desktop smoke test.");
  }

  assertCommandOk(
    spawnSync("unzip", ["-q", releaseZipPath, "-d", extractedRoot], {
      cwd: repoRoot,
      stdio: ["ignore", "ignore", "pipe"],
    }),
    "Artifact extraction",
  );

  const executablePath = resolvePackagedExecutable(extractedRoot);
  const child = spawn(executablePath, [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      T3CODE_HOME: smokeHome,
      T3CODE_PORT: String(smokePort),
      T3CODE_DISABLE_AUTO_UPDATE: "1",
      ELECTRON_ENABLE_LOGGING: "1",
    },
  });

  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  let exitCode = null;
  let exitSignal = null;
  child.on("exit", (code, signal) => {
    exitCode = code;
    exitSignal = signal;
  });

  try {
    await waitForHealthySession(60_000);
    const sawDesktopLog = await waitForFile(desktopLogPath, 10_000);
    if (!sawDesktopLog) {
      throw new Error(`Packaged desktop log was not written at ${desktopLogPath}.`);
    }

    const desktopLog = readFileSync(desktopLogPath, "utf8");
    if (!desktopLog.includes(`bootstrap using shared backend port=${smokePort}`)) {
      throw new Error(
        `Desktop log did not include shared-port bootstrap confirmation.\n\n${desktopLog}`,
      );
    }
    if (desktopLog.includes("reserved backend port")) {
      throw new Error(`Desktop log still references reserved backend ports.\n\n${desktopLog}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        reason,
        exitCode !== null || exitSignal !== null
          ? `Child exited early with code=${String(exitCode)} signal=${String(exitSignal)}.`
          : null,
        output.trim().length > 0 ? `App output:\n${output}` : null,
        keepTemp ? `Temp files preserved at ${tempRoot}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      { cause: error },
    );
  } finally {
    child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolvePromise) => child.once("exit", resolvePromise)),
      sleep(5_000).then(() => {
        if (exitCode === null && exitSignal === null) {
          child.kill("SIGKILL");
        }
      }),
    ]);
    cleanup();
  }

  console.log(`Packaged desktop smoke test passed on port ${smokePort}.`);
}

main().catch((error) => {
  console.error("\nDesktop smoke test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  if (keepTemp) {
    console.error(`\nTemp files preserved at ${tempRoot}`);
  } else {
    cleanup();
  }
  process.exit(1);
});
