import { useEffect, useMemo, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useShallow } from "zustand/react/shallow";

import { useSettings } from "~/hooks/useSettings";
import { useStore } from "../store";
import { useUiStateStore } from "../uiStateStore";
import { ProjectFavicon } from "./ProjectFavicon";
import ThreadSidebar from "./Sidebar";
import { orderItemsByPreferredIds, sortThreadsForSidebar } from "./Sidebar.logic";
import { Sidebar, SidebarProvider, SidebarRail, SidebarTrigger, useSidebar } from "./ui/sidebar";

const MAX_COLLAPSED_DOCK_PINNED_PROJECTS = 3;

function DesktopCollapsedSidebarDock() {
  const navigate = useNavigate();
  const { isMobile, open, setOpen } = useSidebar();
  const { projects, sidebarThreadsById, threadIdsByProjectId } = useStore(
    useShallow((store) => ({
      projects: store.projects,
      sidebarThreadsById: store.sidebarThreadsById,
      threadIdsByProjectId: store.threadIdsByProjectId,
    })),
  );
  const pinnedProjectIds = useUiStateStore((store) => store.pinnedProjectIds);
  const appSettings = useSettings();
  const threadSortOrder = appSettings.sidebarThreadSortOrder;
  const pinnedProjects = useMemo(() => {
    const pinnedProjectIdSet = new Set(pinnedProjectIds);
    return orderItemsByPreferredIds({
      items: projects.filter((project) => pinnedProjectIdSet.has(project.id)),
      preferredIds: pinnedProjectIds,
      getId: (project) => project.id,
    }).slice(0, MAX_COLLAPSED_DOCK_PINNED_PROJECTS);
  }, [pinnedProjectIds, projects]);

  if (isMobile || open) {
    return null;
  }

  const openPinnedProject = (projectId: (typeof projects)[number]["id"]) => {
    setOpen(true);
    const latestThread = sortThreadsForSidebar(
      (threadIdsByProjectId[projectId] ?? [])
        .map((threadId) => sidebarThreadsById[threadId])
        .filter((thread): thread is NonNullable<typeof thread> => thread !== undefined)
        .filter((thread) => thread.archivedAt === null),
      threadSortOrder,
    )[0];

    if (latestThread) {
      void navigate({
        to: "/$threadId",
        params: { threadId: latestThread.id },
      });
      return;
    }

    void navigate({ to: "/" });
  };

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-40 hidden md:block">
      <div className="pointer-events-auto flex items-center gap-1.5 rounded-2xl border border-border bg-background/90 p-1.5 shadow-lg backdrop-blur">
        <SidebarTrigger
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="border border-border/80 bg-background/80 text-muted-foreground shadow-sm hover:bg-accent hover:text-foreground"
        />
        {pinnedProjects.map((project) => (
          <button
            key={project.id}
            type="button"
            title={`Open ${project.name}`}
            aria-label={`Open ${project.name}`}
            className="inline-flex size-7 items-center justify-center rounded-md border border-transparent text-muted-foreground/80 transition-colors hover:border-border hover:bg-accent hover:text-foreground"
            onClick={() => openPinnedProject(project.id)}
          >
            <ProjectFavicon cwd={project.cwd} emoji={project.emoji} className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}

const THREAD_SIDEBAR_WIDTH_STORAGE_KEY = "chat_thread_sidebar_width";
const THREAD_SIDEBAR_MIN_WIDTH = 13 * 16;
const THREAD_MAIN_CONTENT_MIN_WIDTH = 40 * 16;

export function AppSidebarLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();

  useEffect(() => {
    const onMenuAction = window.desktopBridge?.onMenuAction;
    if (typeof onMenuAction !== "function") {
      return;
    }

    const unsubscribe = onMenuAction((action) => {
      if (action !== "open-settings") return;
      void navigate({ to: "/settings" });
    });

    return () => {
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <SidebarProvider defaultOpen>
      <DesktopCollapsedSidebarDock />
      <Sidebar
        side="left"
        collapsible="offcanvas"
        className="border-r border-border bg-card text-foreground max-md:border-0 max-md:bg-background"
        resizable={{
          minWidth: THREAD_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: ({ nextWidth, wrapper }) =>
            wrapper.clientWidth - nextWidth >= THREAD_MAIN_CONTENT_MIN_WIDTH,
          storageKey: THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        <ThreadSidebar />
        <SidebarRail />
      </Sidebar>
      {children}
    </SidebarProvider>
  );
}
