import { AlertTriangleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useSlowRpcAckRequests } from "../rpc/requestLatencyState";
import { getWsConnectionUiState, useWsConnectionStatus } from "../rpc/wsConnectionState";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function formatElapsedSince(startedAtMs: number, nowMs: number): string {
  const elapsedSeconds = Math.max(1, Math.floor((nowMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function SlowRpcAckIndicator() {
  const slowRequests = useSlowRpcAckRequests();
  const status = useWsConnectionStatus();
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (slowRequests.length === 0) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [slowRequests.length]);

  const tooltipContent = useMemo(() => {
    const thresholdSeconds = Math.round((slowRequests[0]?.thresholdMs ?? 0) / 1000);
    return {
      heading: `Waiting longer than ${thresholdSeconds}s for the first server response.`,
      items: slowRequests.map((request) => ({
        key: request.requestId,
        tag: request.tag,
        waited: formatElapsedSince(request.startedAtMs, nowMs),
      })),
    };
  }, [nowMs, slowRequests]);

  if (slowRequests.length === 0 || getWsConnectionUiState(status) !== "connected") {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={`${slowRequests.length} request${slowRequests.length === 1 ? "" : "s"} slow`}
            className="inline-flex h-7 items-center justify-center rounded-md border border-amber-500/35 bg-amber-500/12 px-2 text-amber-700 shadow-sm transition-colors hover:bg-amber-500/18 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-500/45 dark:text-amber-300"
          >
            <AlertTriangleIcon className="size-3.5" />
          </button>
        }
      />
      <TooltipPopup side="bottom" align="end" className="max-w-96 text-left">
        <div className="space-y-2 py-1 leading-tight">
          <p className="font-medium text-popover-foreground">{tooltipContent.heading}</p>
          <p className="text-muted-foreground">
            This usually means the local T3 server is busy or blocked before it can acknowledge the
            request.
          </p>
          <ul className="space-y-1">
            {tooltipContent.items.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-3">
                <code className="min-w-0 flex-1 whitespace-normal break-all rounded bg-muted px-1.5 py-0.5 text-[11px] text-popover-foreground">
                  {item.tag}
                </code>
                <span className="shrink-0 text-[11px] text-muted-foreground">{item.waited}</span>
              </li>
            ))}
          </ul>
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
