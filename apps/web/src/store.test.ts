import {
  DEFAULT_MODEL_BY_PROVIDER,
  MessageId,
  ProjectId,
  ThreadId,
  TurnId,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  markThreadUnread,
  reorderProjects,
  setProjectSetAside,
  syncServerReadModel,
  syncServerThread,
  type AppState,
} from "./store";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    session: null,
    messages: [],
    detailsLoaded: true,
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-02-13T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

function makeState(thread: Thread): AppState {
  return {
    workbooks: [],
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        name: "Project",
        emoji: null,
        color: null,
        groupName: null,
        groupEmoji: null,
        cwd: "/tmp/project",
        model: "gpt-5-codex",
        expanded: true,
        scripts: [],
      },
    ],
    threads: [thread],
    threadsHydrated: true,
  };
}

function makeReadModelThread(overrides: Partial<OrchestrationReadModel["threads"][number]>) {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    messages: [],
    activities: [],
    proposedPlans: [],
    checkpoints: [],
    session: null,
    detailsLoaded: true,
    ...overrides,
  } satisfies OrchestrationReadModel["threads"][number];
}

function makeReadModel(thread: OrchestrationReadModel["threads"][number]): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    updatedAt: "2026-02-27T00:00:00.000Z",
    workbooks: [],
    projects: [
      {
        id: ProjectId.makeUnsafe("project-1"),
        title: "Project",
        emoji: null,
        color: null,
        setAside: false,
        groupName: null,
        groupEmoji: null,
        workspaceRoot: "/tmp/project",
        defaultModel: "gpt-5.3-codex",
        createdAt: "2026-02-27T00:00:00.000Z",
        updatedAt: "2026-02-27T00:00:00.000Z",
        deletedAt: null,
        scripts: [],
      },
    ],
    threads: [thread],
  };
}

function makeReadModelProject(
  overrides: Partial<OrchestrationReadModel["projects"][number]>,
): OrchestrationReadModel["projects"][number] {
  return {
    id: ProjectId.makeUnsafe("project-1"),
    title: "Project",
    emoji: null,
    color: null,
    setAside: false,
    groupName: null,
    groupEmoji: null,
    workspaceRoot: "/tmp/project",
    defaultModel: "gpt-5.3-codex",
    createdAt: "2026-02-27T00:00:00.000Z",
    updatedAt: "2026-02-27T00:00:00.000Z",
    deletedAt: null,
    scripts: [],
    ...overrides,
  };
}

describe("store pure functions", () => {
  it("markThreadUnread moves lastVisitedAt before completion for a completed thread", () => {
    const latestTurnCompletedAt = "2026-02-25T12:30:00.000Z";
    const initialState = makeState(
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-02-25T12:28:00.000Z",
          startedAt: "2026-02-25T12:28:30.000Z",
          completedAt: latestTurnCompletedAt,
          assistantMessageId: null,
        },
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    const updatedThread = next.threads[0];
    expect(updatedThread).toBeDefined();
    expect(updatedThread?.lastVisitedAt).toBe("2026-02-25T12:29:59.999Z");
    expect(Date.parse(updatedThread?.lastVisitedAt ?? "")).toBeLessThan(
      Date.parse(latestTurnCompletedAt),
    );
  });

  it("markThreadUnread does not change a thread without a completed turn", () => {
    const initialState = makeState(
      makeThread({
        latestTurn: null,
        lastVisitedAt: "2026-02-25T12:35:00.000Z",
      }),
    );

    const next = markThreadUnread(initialState, ThreadId.makeUnsafe("thread-1"));

    expect(next).toEqual(initialState);
  });

  it("reorderProjects moves a project to a target index", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const state: AppState = {
      workbooks: [],
      projects: [
        {
          id: project1,
          name: "Project 1",
          emoji: null,
          color: null,
          groupName: null,
          groupEmoji: null,
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project2,
          name: "Project 2",
          emoji: null,
          color: null,
          groupName: null,
          groupEmoji: null,
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project3,
          name: "Project 3",
          emoji: null,
          color: null,
          groupName: null,
          groupEmoji: null,
          cwd: "/tmp/project-3",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
    };

    const next = reorderProjects(state, project1, project3);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project3, project1]);
  });

  it("setProjectSetAside updates the local sidebar visibility state for a project", () => {
    const state: AppState = {
      workbooks: [],
      projects: [
        {
          id: ProjectId.makeUnsafe("project-1"),
          name: "Project 1",
          emoji: null,
          color: null,
          groupName: null,
          groupEmoji: null,
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
    };

    const setAside = setProjectSetAside(state, ProjectId.makeUnsafe("project-1"), true);
    const restored = setProjectSetAside(setAside, ProjectId.makeUnsafe("project-1"), false);

    expect(setAside.projects[0]?.setAside).toBe(true);
    expect(restored.projects[0]?.setAside).toBe(false);
  });
});

describe("store read model sync", () => {
  it("preserves claude model slugs without an active session", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "claude-opus-4-6",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe("claude-opus-4-6");
  });

  it("resolves claude aliases when session provider is claudeAgent", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        model: "sonnet",
        session: {
          threadId: ThreadId.makeUnsafe("thread-1"),
          status: "ready",
          providerName: "claudeAgent",
          runtimeMode: "approval-required",
          activeTurnId: null,
          lastError: null,
          updatedAt: "2026-02-27T00:00:00.000Z",
        },
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.threads[0]?.model).toBe("claude-sonnet-4-6");
  });

  it("preserves project and thread updatedAt timestamps from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel = makeReadModel(
      makeReadModelThread({
        updatedAt: "2026-02-27T00:05:00.000Z",
      }),
    );

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]?.updatedAt).toBe("2026-02-27T00:00:00.000Z");
    expect(next.threads[0]?.updatedAt).toBe("2026-02-27T00:05:00.000Z");
  });

  it("preserves the current project order when syncing incoming read model updates", () => {
    const project1 = ProjectId.makeUnsafe("project-1");
    const project2 = ProjectId.makeUnsafe("project-2");
    const project3 = ProjectId.makeUnsafe("project-3");
    const initialState: AppState = {
      workbooks: [],
      projects: [
        {
          id: project2,
          name: "Project 2",
          emoji: null,
          color: null,
          groupName: null,
          groupEmoji: null,
          cwd: "/tmp/project-2",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
        {
          id: project1,
          name: "Project 1",
          emoji: null,
          color: null,
          groupName: null,
          groupEmoji: null,
          cwd: "/tmp/project-1",
          model: DEFAULT_MODEL_BY_PROVIDER.codex,
          expanded: true,
          scripts: [],
        },
      ],
      threads: [],
      threadsHydrated: true,
    };
    const readModel: OrchestrationReadModel = {
      snapshotSequence: 2,
      updatedAt: "2026-02-27T00:00:00.000Z",
      workbooks: [],
      projects: [
        makeReadModelProject({
          id: project1,
          title: "Project 1",
          workspaceRoot: "/tmp/project-1",
        }),
        makeReadModelProject({
          id: project2,
          title: "Project 2",
          workspaceRoot: "/tmp/project-2",
        }),
        makeReadModelProject({
          id: project3,
          title: "Project 3",
          workspaceRoot: "/tmp/project-3",
        }),
      ],
      threads: [],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects.map((project) => project.id)).toEqual([project2, project1, project3]);
  });

  it("defaults projects to collapsed when no expansion preference has been saved", () => {
    const readModel = makeReadModel(makeReadModelThread({}));

    const next = syncServerReadModel(
      {
        workbooks: [],
        projects: [],
        threads: [],
        threadsHydrated: false,
      },
      readModel,
    );

    expect(next.projects[0]?.expanded).toBe(false);
  });

  it("hydrates project display metadata from the read model", () => {
    const initialState = makeState(makeThread());
    const readModel: OrchestrationReadModel = {
      ...makeReadModel(makeReadModelThread({})),
      projects: [
        makeReadModelProject({
          emoji: ":)",
          color: "#4F46E5",
          groupName: "Workspace",
          groupEmoji: "rocket",
        }),
      ],
    };

    const next = syncServerReadModel(initialState, readModel);

    expect(next.projects[0]).toMatchObject({
      emoji: ":)",
      color: "#4F46E5",
      groupName: "Workspace",
      groupEmoji: "rocket",
    });
  });

  it("hydrates synced set-aside state from the read model", () => {
    const next = syncServerReadModel(
      makeState(makeThread()),
      makeReadModel(makeReadModelThread({})),
    );

    expect(next.projects[0]?.setAside).toBe(false);

    const synced = syncServerReadModel(next, {
      ...makeReadModel(makeReadModelThread({})),
      projects: [
        makeReadModelProject({
          setAside: true,
        }),
      ],
    });

    expect(synced.projects[0]?.setAside).toBe(true);
  });

  it("preserves hydrated thread details when a light snapshot arrives", () => {
    const initialThread = makeThread({
      detailsLoaded: true,
      messages: [
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "still here",
          createdAt: "2026-02-27T00:00:00.000Z",
          completedAt: "2026-02-27T00:00:01.000Z",
          streaming: false,
        },
      ],
    });
    const readModel = makeReadModel(
      makeReadModelThread({
        detailsLoaded: false,
        messages: [],
        activities: [],
        checkpoints: [],
      }),
    );

    const next = syncServerReadModel(makeState(initialThread), readModel);

    expect(next.threads[0]?.detailsLoaded).toBe(true);
    expect(next.threads[0]?.messages.map((message) => message.text)).toEqual(["still here"]);
  });

  it("hydrates one thread from a lazy thread snapshot", () => {
    const initialThread = makeThread({ detailsLoaded: false });
    const fullThread = makeReadModelThread({
      detailsLoaded: true,
      messages: [
        {
          id: MessageId.makeUnsafe("message-1"),
          role: "assistant",
          text: "loaded on demand",
          turnId: null,
          attachments: undefined,
          streaming: false,
          createdAt: "2026-02-27T00:00:00.000Z",
          updatedAt: "2026-02-27T00:00:01.000Z",
        },
      ],
    });

    const next = syncServerThread(makeState(initialThread), fullThread);

    expect(next.threads[0]?.detailsLoaded).toBe(true);
    expect(next.threads[0]?.messages.map((message) => message.text)).toEqual(["loaded on demand"]);
  });
});
