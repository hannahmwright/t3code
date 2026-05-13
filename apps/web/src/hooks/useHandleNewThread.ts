import { DEFAULT_RUNTIME_MODE, type ProjectId, ThreadId } from "@t3tools/contracts";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";
import { inferProviderForModel } from "@t3tools/shared/model";
import {
  type DraftThreadEnvMode,
  type DraftThreadState,
  useComposerDraftStore,
} from "../composerDraftStore";
import { newThreadId } from "../lib/utils";
import { useStore } from "../store";

export function useHandleNewThread() {
  const projects = useStore((store) => store.projects);
  const threads = useStore((store) => store.threads);
  const stickyModel = useComposerDraftStore((store) => store.stickyModel);
  const stickyModelOptions = useComposerDraftStore((store) => store.stickyModelOptions);
  const navigate = useNavigate();
  const routeThreadId = useParams({
    strict: false,
    select: (params) => (params.threadId ? ThreadId.makeUnsafe(params.threadId) : null),
  });
  const activeDraftThread = useComposerDraftStore((store) =>
    routeThreadId ? (store.draftThreadsByThreadId[routeThreadId] ?? null) : null,
  );

  const activeThread = routeThreadId
    ? threads.find((thread) => thread.id === routeThreadId)
    : undefined;

  const handleNewThread = useCallback(
    (
      projectId: ProjectId | null,
      options?: {
        branch?: string | null;
        worktreePath?: string | null;
        envMode?: DraftThreadEnvMode;
        sidechatSourceThreadId?: ThreadId | null;
      },
    ): Promise<void> => {
      const {
        clearProjectDraftThreadId,
        getDraftThread,
        getDraftThreadByProjectId,
        setModel,
        setModelOptions,
        setProvider,
        setDraftThreadContext,
        getLooseDraftThread,
        setLooseDraftThreadId,
        setProjectDraftThreadId,
      } = useComposerDraftStore.getState();
      const hasBranchOption = options?.branch !== undefined;
      const hasWorktreePathOption = options?.worktreePath !== undefined;
      const hasEnvModeOption = options?.envMode !== undefined;
      const hasSidechatSourceOption = options?.sidechatSourceThreadId !== undefined;
      const storedDraftThread =
        projectId === null ? getLooseDraftThread() : getDraftThreadByProjectId(projectId);
      const latestActiveDraftThread: DraftThreadState | null = routeThreadId
        ? getDraftThread(routeThreadId)
        : null;
      if (storedDraftThread) {
        return (async () => {
          if (
            hasBranchOption ||
            hasWorktreePathOption ||
            hasEnvModeOption ||
            hasSidechatSourceOption
          ) {
            setDraftThreadContext(storedDraftThread.threadId, {
              ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
              ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
              ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
              ...(hasSidechatSourceOption
                ? { sidechatSourceThreadId: options?.sidechatSourceThreadId ?? null }
                : {}),
            });
          }
          if (projectId === null) {
            setLooseDraftThreadId(storedDraftThread.threadId);
          } else {
            setProjectDraftThreadId(projectId, storedDraftThread.threadId);
          }
          if (routeThreadId === storedDraftThread.threadId) {
            return;
          }
          await navigate({
            to: "/$threadId",
            params: { threadId: storedDraftThread.threadId },
          });
        })();
      }

      if (projectId !== null) {
        clearProjectDraftThreadId(projectId);
      }

      if (
        latestActiveDraftThread &&
        routeThreadId &&
        latestActiveDraftThread.projectId === projectId
      ) {
        if (
          hasBranchOption ||
          hasWorktreePathOption ||
          hasEnvModeOption ||
          hasSidechatSourceOption
        ) {
          setDraftThreadContext(routeThreadId, {
            ...(hasBranchOption ? { branch: options?.branch ?? null } : {}),
            ...(hasWorktreePathOption ? { worktreePath: options?.worktreePath ?? null } : {}),
            ...(hasEnvModeOption ? { envMode: options?.envMode } : {}),
            ...(hasSidechatSourceOption
              ? { sidechatSourceThreadId: options?.sidechatSourceThreadId ?? null }
              : {}),
          });
        }
        if (projectId === null) {
          setLooseDraftThreadId(routeThreadId);
        } else {
          setProjectDraftThreadId(projectId, routeThreadId);
        }
        return Promise.resolve();
      }

      const threadId = newThreadId();
      const createdAt = new Date().toISOString();
      return (async () => {
        const draftOptions = {
          createdAt,
          branch: options?.branch ?? null,
          worktreePath: options?.worktreePath ?? null,
          envMode: options?.envMode ?? "local",
          runtimeMode: DEFAULT_RUNTIME_MODE,
          sidechatSourceThreadId: options?.sidechatSourceThreadId ?? null,
        };
        if (projectId === null) {
          setLooseDraftThreadId(threadId, draftOptions);
        } else {
          setProjectDraftThreadId(projectId, threadId, draftOptions);
        }
        if (stickyModel) {
          setProvider(threadId, inferProviderForModel(stickyModel));
          setModel(threadId, stickyModel);
        }
        if (Object.keys(stickyModelOptions).length > 0) {
          setModelOptions(threadId, stickyModelOptions);
        }

        await navigate({
          to: "/$threadId",
          params: { threadId },
        });
      })();
    },
    [navigate, routeThreadId, stickyModel, stickyModelOptions],
  );

  return {
    activeDraftThread,
    activeThread,
    handleNewThread,
    projects,
    routeThreadId,
  };
}
