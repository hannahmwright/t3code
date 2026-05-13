import { readEnvironmentFromLoginShell, ShellEnvironmentReader } from "@t3tools/shared/shell";

const SHELL_ENVIRONMENT_KEYS = ["PATH", "SSH_AUTH_SOCK"];

export function syncShellEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  options: {
    platform?: NodeJS.Platform;
    readEnvironment?: ShellEnvironmentReader;
  } = {},
): void {
  if ((options.platform ?? process.platform) !== "darwin") return;

  try {
    const shell = env.SHELL ?? "/bin/zsh";
    const shellEnvironment = (options.readEnvironment ?? readEnvironmentFromLoginShell)(
      shell,
      SHELL_ENVIRONMENT_KEYS,
    );

    if (shellEnvironment.PATH) {
      env.PATH = shellEnvironment.PATH;
    }

    if (!env.SSH_AUTH_SOCK && shellEnvironment.SSH_AUTH_SOCK) {
      env.SSH_AUTH_SOCK = shellEnvironment.SSH_AUTH_SOCK;
    }
  } catch {
    // Keep inherited environment if shell lookup fails.
  }
}
