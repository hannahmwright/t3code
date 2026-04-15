const { createHash } = require("node:crypto");
const { readFileSync, readdirSync, existsSync } = require("node:fs");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

function resolveAppBundle(appOutDir) {
  const entries = readdirSync(appOutDir, { withFileTypes: true });
  const appEntry = entries.find((entry) => entry.isDirectory() && entry.name.endsWith(".app"));
  if (!appEntry) {
    throw new Error(`Unable to locate .app bundle in ${appOutDir}`);
  }
  return join(appOutDir, appEntry.name);
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appBundlePath = resolveAppBundle(context.appOutDir);
  const appAsarPath = join(appBundlePath, "Contents", "Resources", "app.asar");
  const infoPlistPath = join(appBundlePath, "Contents", "Info.plist");

  if (!existsSync(appAsarPath) || !existsSync(infoPlistPath)) {
    throw new Error(`Missing packaged app metadata at ${appBundlePath}`);
  }

  const hash = createHash("sha256").update(readFileSync(appAsarPath)).digest("hex");
  const integrityValue = JSON.stringify({
    "Resources/app.asar": {
      algorithm: "SHA256",
      hash,
    },
  });

  execFileSync(
    "/usr/bin/plutil",
    ["-replace", "ElectronAsarIntegrity", "-json", integrityValue, infoPlistPath],
    { stdio: "inherit" },
  );
};
