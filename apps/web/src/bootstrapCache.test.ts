import {
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ThreadId,
  type OrchestrationReadModel,
  type ServerConfig,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearBootstrapCache,
  persistReadModelToBootstrapCache,
  persistServerConfigToBootstrapCache,
  readBootstrapCache,
} from "./bootstrapCache";

function makeServerConfig(): ServerConfig {
  return {
    cwd: "/tmp/workspace",
    keybindingsConfigPath: "/tmp/workspace/.config/keybindings.json",
    keybindings: [],
    issues: [],
    providers: [
      {
        provider: "codex",
        enabled: true,
        installed: true,
        version: "0.116.0",
        status: "ready",
        auth: { status: "authenticated" },
        checkedAt: "2026-04-10T12:00:00.000Z",
        models: [],
      },
    ],
    availableEditors: ["cursor"],
    observability: {
      logsDirectoryPath: "/tmp/workspace/.config/logs",
      localTracingEnabled: true,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
  };
}

function makeReadModel(): OrchestrationReadModel {
  return {
    snapshotSequence: 4,
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Workspace",
        emoji: null,
        color: null,
        groupName: null,
        groupEmoji: null,
        workspaceRoot: "/tmp/workspace",
        defaultModelSelection: null,
        scripts: [],
        createdAt: "2026-04-10T11:00:00.000Z",
        updatedAt: "2026-04-10T11:05:00.000Z",
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: ThreadId.makeUnsafe("thread-1"),
        projectId: ProjectId.makeUnsafe("project-1"),
        title: "Cached thread",
        modelSelection: {
          provider: "codex",
          model: "gpt-5.4",
        },
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        session: null,
        messages: [],
        proposedPlans: [],
        checkpoints: [],
        activities: [],
        latestTurn: null,
        createdAt: "2026-04-10T11:10:00.000Z",
        updatedAt: "2026-04-10T11:12:00.000Z",
        deletedAt: null,
        archivedAt: null,
      },
    ],
    updatedAt: "2026-04-10T11:12:00.000Z",
  };
}

describe("bootstrapCache", () => {
  beforeEach(() => {
    vi.useRealTimers();
    clearBootstrapCache();
  });

  afterEach(() => {
    clearBootstrapCache();
    vi.useRealTimers();
  });

  it("persists and restores the latest bootstrap payload", () => {
    const serverConfig = makeServerConfig();
    const readModel = makeReadModel();

    persistServerConfigToBootstrapCache(serverConfig);
    persistReadModelToBootstrapCache(readModel);

    expect(readBootstrapCache()).toMatchObject({
      updatedAt: expect.any(String),
      serverConfig,
      shellState: {
        projects: [
          expect.objectContaining({
            id: ProjectId.makeUnsafe("project-1"),
            name: "Workspace",
            cwd: "/tmp/workspace",
          }),
        ],
        threads: [
          expect.objectContaining({
            id: ThreadId.makeUnsafe("thread-1"),
            projectId: ProjectId.makeUnsafe("project-1"),
            title: "Cached thread",
          }),
        ],
      },
    });
  });

  it("persists shell state when a thread session has no active turn", () => {
    const readModel = makeReadModel();
    const firstThread = readModel.threads[0];
    expect(firstThread).toBeDefined();
    if (!firstThread) {
      throw new Error("Missing bootstrap thread fixture");
    }
    const nextReadModel: OrchestrationReadModel = {
      ...readModel,
      threads: [
        {
          ...firstThread,
          session: {
            threadId: ThreadId.makeUnsafe("thread-1"),
            status: "ready",
            providerName: "codex",
            runtimeMode: "full-access",
            activeTurnId: null,
            lastError: null,
            updatedAt: "2026-04-10T11:12:00.000Z",
          },
        },
      ],
    };

    persistReadModelToBootstrapCache(nextReadModel);

    expect(readBootstrapCache()?.shellState?.threads[0]?.session).toMatchObject({
      provider: "codex",
      status: "ready",
      orchestrationStatus: "ready",
      createdAt: "2026-04-10T11:12:00.000Z",
      updatedAt: "2026-04-10T11:12:00.000Z",
    });
    expect(readBootstrapCache()?.shellState?.threads[0]?.session).not.toHaveProperty("activeTurnId");
  });

  it("drops stale cache entries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00.000Z"));

    persistServerConfigToBootstrapCache(makeServerConfig());

    vi.setSystemTime(new Date("2026-04-11T12:00:00.001Z"));

    expect(readBootstrapCache()).toBeNull();
  });
});
