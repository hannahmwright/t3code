import {
  ModelSelection,
  OrchestrationShellReadModel,
  OrchestrationLatestTurn,
  OrchestrationSessionStatus,
  ProjectId,
  ProjectScript,
  ProviderInteractionMode,
  ProviderKind,
  ServerConfig,
  type ServerConfig as ServerConfigData,
  RuntimeMode,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { deriveShellBootstrapStateFromShellReadModel, type ShellBootstrapState } from "./store";
import {
  getLocalStorageItem,
  removeLocalStorageItem,
  setLocalStorageItem,
} from "./hooks/useLocalStorage";

const BOOTSTRAP_CACHE_STORAGE_KEY = "t3code:bootstrap-cache:v2";
const BOOTSTRAP_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;

const BootstrapThreadSessionSchema = Schema.Struct({
  provider: ProviderKind,
  status: Schema.Literals(["disconnected", "connecting", "ready", "running", "error", "closed"]),
  activeTurnId: Schema.optional(TurnId),
  createdAt: Schema.String,
  updatedAt: Schema.String,
  lastError: Schema.optional(Schema.String),
  orchestrationStatus: OrchestrationSessionStatus,
});

const BootstrapProjectSchema = Schema.Struct({
  id: ProjectId,
  name: Schema.String,
  emoji: Schema.NullOr(Schema.String),
  color: Schema.optional(Schema.NullOr(Schema.String)),
  groupName: Schema.NullOr(Schema.String),
  groupEmoji: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  defaultModelSelection: Schema.NullOr(ModelSelection),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  scripts: Schema.Array(ProjectScript),
});

const BootstrapThreadSchema = Schema.Struct({
  id: ThreadId,
  projectId: ProjectId,
  title: Schema.String,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  session: Schema.NullOr(BootstrapThreadSessionSchema),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  archivedAt: Schema.NullOr(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  latestTurn: Schema.NullOr(OrchestrationLatestTurn),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  latestUserMessageAt: Schema.NullOr(Schema.String),
  hasPendingApprovals: Schema.Boolean,
  hasPendingUserInput: Schema.Boolean,
  hasActionableProposedPlan: Schema.Boolean,
});

const ShellBootstrapStateSchema = Schema.Struct({
  projects: Schema.Array(BootstrapProjectSchema),
  threads: Schema.Array(BootstrapThreadSchema),
});

const BootstrapCacheSchema = Schema.Struct({
  updatedAt: Schema.String,
  serverConfig: Schema.NullOr(ServerConfig),
  shellState: Schema.NullOr(ShellBootstrapStateSchema),
});

type ShellBootstrapStateFromCache = typeof ShellBootstrapStateSchema.Type;
type BootstrapCacheFromStorage = typeof BootstrapCacheSchema.Type;

export interface BootstrapCache {
  updatedAt: string;
  serverConfig: ServerConfigData | null;
  shellState: ShellBootstrapState | null;
}

function normalizeShellBootstrapState(
  shellState: ShellBootstrapStateFromCache,
): ShellBootstrapState {
  return {
    projects: shellState.projects.map((project) => ({
      ...project,
      color: project.color ?? null,
      scripts: project.scripts.map((script) => ({ ...script })),
    })),
    threads: shellState.threads.map((thread) => ({
      ...thread,
      session: thread.session
        ? {
            provider: thread.session.provider,
            status: thread.session.status,
            createdAt: thread.session.createdAt,
            updatedAt: thread.session.updatedAt,
            orchestrationStatus: thread.session.orchestrationStatus,
            ...(thread.session.activeTurnId !== undefined
              ? { activeTurnId: thread.session.activeTurnId }
              : {}),
            ...(thread.session.lastError !== undefined
              ? { lastError: thread.session.lastError }
              : {}),
          }
        : null,
    })),
  };
}

function normalizeBootstrapCache(cache: BootstrapCacheFromStorage): BootstrapCache {
  return {
    updatedAt: cache.updatedAt,
    serverConfig: cache.serverConfig,
    shellState: cache.shellState ? normalizeShellBootstrapState(cache.shellState) : null,
  };
}

function clearCorruptBootstrapCache() {
  try {
    removeLocalStorageItem(BOOTSTRAP_CACHE_STORAGE_KEY);
  } catch {
    // Ignore localStorage errors and keep booting without cached state.
  }
}

function isFresh(cache: BootstrapCache): boolean {
  const updatedAtMs = new Date(cache.updatedAt).getTime();
  return Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= BOOTSTRAP_CACHE_MAX_AGE_MS;
}

function writeBootstrapCache(cache: BootstrapCache): void {
  try {
    setLocalStorageItem(BOOTSTRAP_CACHE_STORAGE_KEY, cache, BootstrapCacheSchema);
  } catch {
    console.warn("[bootstrap-cache] Unable to persist bootstrap cache. Falling back to live load.");
    clearCorruptBootstrapCache();
  }
}

export function clearBootstrapCache(): void {
  clearCorruptBootstrapCache();
}

export function readBootstrapCache(): BootstrapCache | null {
  try {
    const cache = getLocalStorageItem(BOOTSTRAP_CACHE_STORAGE_KEY, BootstrapCacheSchema);
    if (cache === null) {
      return null;
    }
    const normalizedCache = normalizeBootstrapCache(cache);
    if (!isFresh(normalizedCache)) {
      clearCorruptBootstrapCache();
      return null;
    }
    return normalizedCache;
  } catch {
    clearCorruptBootstrapCache();
    return null;
  }
}

export function persistServerConfigToBootstrapCache(serverConfig: ServerConfigData): void {
  const current = readBootstrapCache();
  writeBootstrapCache({
    updatedAt: new Date().toISOString(),
    serverConfig,
    shellState: current?.shellState ?? null,
  });
}

function toShellBootstrapState(
  shellReadModel: typeof OrchestrationShellReadModel.Type,
): ShellBootstrapState {
  return deriveShellBootstrapStateFromShellReadModel(shellReadModel);
}

export function persistShellReadModelToBootstrapCache(
  shellReadModel: typeof OrchestrationShellReadModel.Type,
): void {
  const current = readBootstrapCache();
  writeBootstrapCache({
    updatedAt: new Date().toISOString(),
    serverConfig: current?.serverConfig ?? null,
    shellState: toShellBootstrapState(shellReadModel),
  });
}
