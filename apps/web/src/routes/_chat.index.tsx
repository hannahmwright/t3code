import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { isElectron } from "../env";
import { SidebarInset, SidebarTrigger, useSidebar } from "../components/ui/sidebar";

function ChatIndexRouteView() {
  const { isMobile, openMobile, setOpenMobile } = useSidebar();

  useEffect(() => {
    if (!isMobile || openMobile) {
      return;
    }
    setOpenMobile(true);
  }, [isMobile, openMobile, setOpenMobile]);

  return (
    <SidebarInset className="min-h-0 bg-background text-muted-foreground/40 max-md:min-h-[var(--app-shell-height)] max-md:overflow-visible max-md:overscroll-y-auto md:h-dvh md:overflow-hidden md:overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-muted-foreground/40">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 max-md:bg-background/92 max-md:pt-[calc(env(safe-area-inset-top)+0.5rem)] max-md:backdrop-blur-xl md:hidden">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-7 shrink-0" />
              <span className="text-sm font-medium text-foreground">Threads</span>
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs text-muted-foreground/50">No active thread</span>
          </div>
        )}

        <div className="flex flex-1 items-center justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <div className="text-center">
            <p className="text-sm">Select a thread or create a new one to get started.</p>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
