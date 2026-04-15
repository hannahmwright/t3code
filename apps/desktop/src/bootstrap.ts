const { createRequire } = require("node:module") as typeof import("node:module");
const FS = require("node:fs") as typeof import("node:fs");
const OS = require("node:os") as typeof import("node:os");
const Path = require("node:path") as typeof import("node:path");
const runtimeRequire = createRequire(__filename);

let app: typeof import("electron").app | undefined;
let dialog: typeof import("electron").dialog | undefined;

const BASE_DIR = process.env.T3CODE_HOME?.trim() || Path.join(OS.homedir(), ".t3");
const LOG_PATH = Path.join(BASE_DIR, "userdata", "logs", "desktop-bootstrap.log");

function appendBootstrapLog(message: string): void {
  try {
    FS.mkdirSync(Path.dirname(LOG_PATH), { recursive: true });
    FS.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${message}\n`, "utf8");
  } catch {
    // Best-effort only.
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function failWithoutElectron(stage: string, error: unknown): never {
  const detail = formatError(error);
  appendBootstrapLog(`fatal stage=${stage} detail=${detail}`);
  console.error(`T3 Code failed to start during ${stage}\n${detail}`);
  process.exit(1);
}

function handleBootstrapFailure(stage: string, error: unknown): void {
  if (!app || !dialog) {
    failWithoutElectron(stage, error);
  }
  const detail = formatError(error);
  appendBootstrapLog(`fatal stage=${stage} detail=${detail}`);
  try {
    dialog.showErrorBox("T3 Code failed to start", `${stage}\n\n${detail}`);
  } catch {
    // Ignore dialog failures and terminate.
  }
  app.exit(1);
}

appendBootstrapLog(
  `bootstrap entry pid=${process.pid} electronRunAsNode=${process.env.ELECTRON_RUN_AS_NODE ?? ""}`,
);

try {
  ({ app, dialog } = runtimeRequire("electron") as typeof import("electron"));
  appendBootstrapLog(`electron module loaded packaged=${String(app.isPackaged)}`);
} catch (error) {
  failWithoutElectron("require-electron", error);
}

process.on("uncaughtException", (error) => {
  handleBootstrapFailure("uncaughtException", error);
});

process.on("unhandledRejection", (error) => {
  handleBootstrapFailure("unhandledRejection", error);
});

try {
  runtimeRequire("./main.js");
  appendBootstrapLog("main module loaded");
} catch (error) {
  handleBootstrapFailure("require-main", error);
}
