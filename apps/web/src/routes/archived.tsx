import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsPageLayout } from "../components/settings/SettingsPageLayout";

const LazyArchivedThreadsPanel = lazy(() =>
  import("../components/settings/SettingsPanels").then((module) => ({
    default: module.ArchivedThreadsPanel,
  })),
);

function ArchivedPanelFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 py-10 text-sm text-muted-foreground">
      Loading archived threads...
    </div>
  );
}

function ArchivedRouteView() {
  return (
    <SettingsPageLayout title="Archived">
      <Suspense fallback={<ArchivedPanelFallback />}>
        <LazyArchivedThreadsPanel />
      </Suspense>
    </SettingsPageLayout>
  );
}

export const Route = createFileRoute("/archived")({
  component: ArchivedRouteView,
});
