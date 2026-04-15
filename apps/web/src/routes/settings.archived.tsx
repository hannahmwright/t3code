import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const LazyArchivedThreadsPanel = lazy(() =>
  import("../components/settings/SettingsPanels").then((module) => ({
    default: module.ArchivedThreadsPanel,
  })),
);

function SettingsPanelFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 py-10 text-sm text-muted-foreground">
      Loading archived threads...
    </div>
  );
}

function ArchivedThreadsRouteView() {
  return (
    <Suspense fallback={<SettingsPanelFallback />}>
      <LazyArchivedThreadsPanel />
    </Suspense>
  );
}

export const Route = createFileRoute("/settings/archived")({
  component: ArchivedThreadsRouteView,
});
