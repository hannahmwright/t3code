import { Suspense, lazy } from "react";
import { createFileRoute } from "@tanstack/react-router";

const LazyGeneralSettingsPanel = lazy(() =>
  import("../components/settings/SettingsPanels").then((module) => ({
    default: module.GeneralSettingsPanel,
  })),
);

function SettingsPanelFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background px-6 py-10 text-sm text-muted-foreground">
      Loading settings...
    </div>
  );
}

function GeneralSettingsRouteView() {
  return (
    <Suspense fallback={<SettingsPanelFallback />}>
      <LazyGeneralSettingsPanel />
    </Suspense>
  );
}

export const Route = createFileRoute("/settings/general")({
  component: GeneralSettingsRouteView,
});
