import { RotateCcwIcon } from "lucide-react";
import { Suspense, lazy, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import { SettingsPageLayout } from "../components/settings/SettingsPageLayout";
import { useSettingsRestore } from "../components/settings/useSettingsRestore";
import { Button } from "../components/ui/button";
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

function SettingsRouteView() {
  const [restoreSignal, setRestoreSignal] = useState(0);
  const { changedSettingLabels, restoreDefaults } = useSettingsRestore(() =>
    setRestoreSignal((value) => value + 1),
  );

  return (
    <SettingsPageLayout
      title="Settings"
      toolbar={
        <Button
          size="xs"
          variant="outline"
          disabled={changedSettingLabels.length === 0}
          onClick={() => void restoreDefaults()}
        >
          <RotateCcwIcon className="size-3.5" />
          Restore defaults
        </Button>
      }
    >
      <div key={restoreSignal} className="min-h-0 flex flex-1 flex-col">
        <Suspense fallback={<SettingsPanelFallback />}>
          <LazyGeneralSettingsPanel />
        </Suspense>
      </div>
    </SettingsPageLayout>
  );
}

export const Route = createFileRoute("/settings")({
  component: SettingsRouteView,
});
