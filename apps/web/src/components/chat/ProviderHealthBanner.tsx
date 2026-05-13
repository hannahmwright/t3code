import { type ServerProviderStatus } from "@t3tools/contracts";
import { memo } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { CircleAlertIcon, XIcon } from "lucide-react";

import { buildProviderHealthAlertKey, useDismissedAlert } from "~/lib/alertDismissal";

export const ProviderHealthBanner = memo(function ProviderHealthBanner({
  status,
}: {
  status: ServerProviderStatus | null;
}) {
  const alertKey = status && status.status !== "ready" ? buildProviderHealthAlertKey(status) : null;
  const { dismissed, dismiss } = useDismissedAlert(alertKey);

  if (!status || status.status === "ready" || dismissed) {
    return null;
  }

  const providerLabel =
    status.provider === "codex"
      ? "Codex"
      : status.provider === "claudeAgent"
        ? "Claude"
        : status.provider;
  const defaultMessage =
    status.status === "error"
      ? `${providerLabel} provider is unavailable.`
      : `${providerLabel} provider has limited availability.`;
  const title = `${providerLabel} provider status`;

  return (
    <div className="pt-3 mx-auto max-w-3xl">
      <Alert variant={status.status === "error" ? "error" : "warning"}>
        <CircleAlertIcon />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="line-clamp-3" title={status.message ?? defaultMessage}>
          {status.message ?? defaultMessage}
        </AlertDescription>
        <AlertAction>
          <button
            type="button"
            aria-label={`Dismiss ${providerLabel} provider status alert`}
            className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:text-foreground"
            onClick={dismiss}
          >
            <XIcon className="size-3.5" />
          </button>
        </AlertAction>
      </Alert>
    </div>
  );
});
