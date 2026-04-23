import type { OrchestrationReadModel } from "@t3tools/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { SidebarInset, SidebarTrigger } from "../components/ui/sidebar";
import { readNativeApi } from "../nativeApi";
import { isElectron } from "../env";

type ArchivedThreadItem = {
  id: OrchestrationReadModel["threads"][number]["id"];
  title: string;
  projectTitle: string;
  archivedAt: string;
  messageCount: number;
  latestPreview: string | null;
};

function formatTimestamp(value: string): string {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

function truncatePreview(value: string | null): string {
  if (value === null) {
    return "No messages";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "No messages";
  }

  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function ArchivedRouteView() {
  const archivedThreadsQuery = useQuery({
    queryKey: ["archived-threads"],
    staleTime: 10_000,
    refetchInterval: 15_000,
    queryFn: async (): Promise<ArchivedThreadItem[]> => {
      const api = readNativeApi();
      if (!api) {
        return [];
      }

      const snapshot = await api.orchestration.getSnapshot();
      const projectTitleById = new Map(
        snapshot.projects.map((project) => [project.id, project.title] as const),
      );

      return snapshot.threads
        .filter((thread) => thread.deletedAt !== null)
        .map((thread) => ({
          id: thread.id,
          title: thread.title,
          projectTitle: projectTitleById.get(thread.projectId) ?? "Unknown project",
          archivedAt: thread.deletedAt ?? thread.updatedAt,
          messageCount: thread.messages.length,
          latestPreview: thread.messages.at(-1)?.text ?? null,
        }))
        .toSorted((left, right) => right.archivedAt.localeCompare(left.archivedAt));
    },
  });

  const archivedThreads = archivedThreadsQuery.data ?? [];

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0 md:hidden" />
              <span className="text-sm font-medium text-foreground">Archived</span>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              Archived
            </span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {archivedThreadsQuery.isLoading ? (
              <div className="rounded-xl border border-border/70 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                Loading archived threads...
              </div>
            ) : archivedThreads.length === 0 ? (
              <div className="rounded-xl border border-border/70 bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                No archived threads yet.
              </div>
            ) : (
              archivedThreads.map((thread) => (
                <section
                  key={thread.id}
                  className="rounded-xl border border-border/70 bg-card px-4 py-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">{thread.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{thread.projectTitle}</p>
                    </div>
                    <p className="shrink-0 text-[11px] text-muted-foreground">
                      {formatTimestamp(thread.archivedAt)}
                    </p>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {truncatePreview(thread.latestPreview)}
                  </p>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {thread.messageCount} message{thread.messageCount === 1 ? "" : "s"}
                  </p>
                </section>
              ))
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/archived")({
  component: ArchivedRouteView,
});
