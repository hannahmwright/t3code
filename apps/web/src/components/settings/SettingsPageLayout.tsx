import { useEffect, type ReactNode } from "react";

import { isElectron } from "../../env";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";

export function SettingsPageLayout(props: {
  title: string;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const { children, title, toolbar } = props;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Escape") return;

      event.preventDefault();
      window.history.back();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <SidebarInset className="min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground isolate max-md:min-h-[var(--app-shell-height)] md:h-dvh">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {!isElectron && (
          <header className="border-b border-border px-3 py-2 sm:px-5 max-md:sticky max-md:top-0 max-md:z-30 max-md:bg-background/92 max-md:px-3 max-md:pt-[calc(env(safe-area-inset-top)+0.5rem)] max-md:pb-3 max-md:backdrop-blur-xl">
            <div className="flex items-center gap-2">
              <SidebarTrigger className="size-11 shrink-0 rounded-full border border-border/70 bg-background/85 shadow-sm md:hidden" />
              <span className="text-sm font-medium text-foreground">{title}</span>
              {toolbar ? <div className="ms-auto flex items-center gap-2">{toolbar}</div> : null}
            </div>
          </header>
        )}

        {isElectron && (
          <div className="drag-region flex h-[52px] shrink-0 items-center border-b border-border px-5">
            <span className="text-xs font-medium tracking-wide text-muted-foreground/70">
              {title}
            </span>
            {toolbar ? (
              <div className="ms-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
                {toolbar}
              </div>
            ) : null}
          </div>
        )}

        <div className="min-h-0 flex flex-1 flex-col">{children}</div>
      </div>
    </SidebarInset>
  );
}
