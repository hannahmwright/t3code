import {
  useCallback,
  useEffect,
  useRef,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import type { ThreadId } from "@t3tools/contracts";
import type { SplitDirection, SplitDropSide } from "../../splitViewStore";
import { cn } from "../../lib/utils";

export const THREAD_DRAG_MIME = "application/x-t3-thread";
const THREAD_DRAG_TEXT_PREFIX = "t3-thread:";

export interface ThreadDragPayload {
  threadId: ThreadId;
}

export function serializeThreadDragPayload(threadId: ThreadId): string {
  return JSON.stringify({ threadId });
}

export function serializeThreadDragText(threadId: ThreadId): string {
  return `${THREAD_DRAG_TEXT_PREFIX}${serializeThreadDragPayload(threadId)}`;
}

type DropZone = "top" | "bottom" | "left" | "right";

const DROP_ZONE_PREVIEW_CLASS: Record<DropZone, string> = {
  top: "left-0 right-0 top-0 h-1/2",
  bottom: "left-0 right-0 bottom-0 h-1/2",
  left: "top-0 bottom-0 left-0 w-1/2",
  right: "top-0 bottom-0 right-0 w-1/2",
};
const DROP_ZONE_PREVIEW_BASE_CLASS =
  "absolute m-1 rounded-md bg-info/18 ring-1 ring-inset ring-info/65";

function dropZoneToDirectionSide(zone: DropZone): {
  direction: SplitDirection;
  side: SplitDropSide;
} {
  if (zone === "top") return { direction: "vertical", side: "first" };
  if (zone === "bottom") return { direction: "vertical", side: "second" };
  if (zone === "left") return { direction: "horizontal", side: "first" };
  return { direction: "horizontal", side: "second" };
}

function isThreadDrag(event: ReactDragEvent): boolean {
  const types = new Set(event.dataTransfer.types);
  return types.has(THREAD_DRAG_MIME) || types.has("text/plain");
}

function parseThreadDragPayload(event: ReactDragEvent): ThreadDragPayload | null {
  try {
    const customPayload = event.dataTransfer.getData(THREAD_DRAG_MIME);
    const textPayload = event.dataTransfer.getData("text/plain");
    const raw =
      customPayload ||
      (textPayload.startsWith(THREAD_DRAG_TEXT_PREFIX)
        ? textPayload.slice(THREAD_DRAG_TEXT_PREFIX.length)
        : "");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ThreadDragPayload>;
    return typeof parsed.threadId === "string" ? { threadId: parsed.threadId as ThreadId } : null;
  } catch {
    return null;
  }
}

function getDropZoneFromPointer(
  rect: DOMRect,
  clientX: number,
  clientY: number,
  isZoneAllowed: (zone: DropZone) => boolean,
): DropZone | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const relX = (clientX - rect.left) / rect.width;
  const relY = (clientY - rect.top) / rect.height;
  if (relX < 0 || relX > 1 || relY < 0 || relY > 1) return null;

  const horizontalAllowed = isZoneAllowed("left") || isZoneAllowed("right");
  const verticalAllowed = isZoneAllowed("top") || isZoneAllowed("bottom");
  if (!horizontalAllowed && !verticalAllowed) return null;
  if (!horizontalAllowed) return relY < 0.5 ? "top" : "bottom";
  if (!verticalAllowed) return relX < 0.5 ? "left" : "right";

  if (rect.width >= rect.height) {
    if (relX < 1 / 3) return "left";
    if (relX > 2 / 3) return "right";
    return relY < 0.5 ? "top" : "bottom";
  }
  if (relY < 1 / 3) return "top";
  if (relY > 2 / 3) return "bottom";
  return relX < 0.5 ? "left" : "right";
}

export function ChatPaneDropOverlay(props: {
  children: ReactNode;
  className?: string;
  paneScopeId?: string;
  excludedThreadIds?: ReadonlySet<ThreadId>;
  canDropInDirection?: (direction: SplitDirection) => boolean;
  onDrop: (payload: ThreadDragPayload & { direction: SplitDirection; side: SplitDropSide }) => void;
}) {
  const { canDropInDirection, children, className, excludedThreadIds, onDrop, paneScopeId } = props;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const activeZoneRef = useRef<DropZone | null>(null);

  const isZoneAllowed = useCallback(
    (zone: DropZone) => {
      const { direction } = dropZoneToDirectionSide(zone);
      return canDropInDirection ? canDropInDirection(direction) : true;
    },
    [canDropInDirection],
  );

  const setPreviewZone = useCallback((zone: DropZone | null) => {
    const preview = previewRef.current;
    if (!preview) return;
    if (activeZoneRef.current === zone) return;
    activeZoneRef.current = zone;
    preview.className = zone ? cn(DROP_ZONE_PREVIEW_BASE_CLASS, DROP_ZONE_PREVIEW_CLASS[zone]) : "";
  }, []);

  const getZone = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const rect = wrapperRef.current?.getBoundingClientRect();
      return rect
        ? getDropZoneFromPointer(rect, event.clientX, event.clientY, isZoneAllowed)
        : null;
    },
    [isZoneAllowed],
  );

  const getAllowedZone = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, options?: { requirePayload?: boolean }) => {
      const zone = getZone(event);
      if (!zone) return null;
      const payload = parseThreadDragPayload(event);
      if (!payload && options?.requirePayload) return null;
      if (payload && excludedThreadIds?.has(payload.threadId)) return null;
      return zone;
    },
    [excludedThreadIds, getZone],
  );

  const reset = useCallback(() => setPreviewZone(null), [setPreviewZone]);

  useEffect(() => reset, [paneScopeId, reset]);

  return (
    <div
      ref={wrapperRef}
      className={cn("relative flex min-h-0 min-w-0 flex-1 flex-col", className)}
      onDragEnter={(event) => {
        if (!isThreadDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const zone = getAllowedZone(event);
        event.dataTransfer.dropEffect = zone ? "move" : "none";
        setPreviewZone(zone);
      }}
      onDragOver={(event) => {
        if (!isThreadDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const zone = getAllowedZone(event);
        event.dataTransfer.dropEffect = zone ? "move" : "none";
        setPreviewZone(zone);
      }}
      onDragLeave={(event) => {
        if (!isThreadDrag(event)) return;
        const related = event.relatedTarget as Node | null;
        if (related && wrapperRef.current?.contains(related)) return;
        reset();
      }}
      onDrop={(event) => {
        if (!isThreadDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        const zone = getAllowedZone(event, { requirePayload: true });
        const payload = parseThreadDragPayload(event);
        reset();
        if (!zone || !payload) return;
        onDrop({ ...payload, ...dropZoneToDirectionSide(zone) });
      }}
    >
      {children}
      <div className="pointer-events-none absolute inset-0 z-50">
        <div ref={previewRef} />
      </div>
    </div>
  );
}
