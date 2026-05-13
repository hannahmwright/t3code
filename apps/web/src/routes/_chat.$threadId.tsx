import { ThreadId } from "@t3tools/contracts";
import { createFileRoute, retainSearchParams, useNavigate } from "@tanstack/react-router";
import {
  Suspense,
  lazy,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import ChatView from "../components/ChatView";
import { DiffWorkerPoolProvider } from "../components/DiffWorkerPoolProvider";
import {
  DiffPanelHeaderSkeleton,
  DiffPanelLoadingState,
  DiffPanelShell,
  type DiffPanelMode,
} from "../components/DiffPanelShell";
import { useComposerDraftStore } from "../composerDraftStore";
import {
  type DiffRouteSearch,
  parseDiffRouteSearch,
  stripDiffSearchParams,
} from "../diffRouteSearch";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useStore } from "../store";
import { Sheet, SheetPopup } from "../components/ui/sheet";
import { Sidebar, SidebarInset, SidebarProvider, SidebarRail } from "~/components/ui/sidebar";
import { ChatPaneDropOverlay } from "../components/chat-drop-overlay/ChatPaneDropOverlay";
import { Button } from "../components/ui/button";
import { XIcon } from "lucide-react";
import { canSubdividePane, collectLeaves } from "../splitView.logic";
import {
  resolveSplitViewFocusedThreadId,
  resolveSplitViewPaneThreadId,
  resolveSplitViewThreadIds,
  selectSplitView,
  useSplitViewStore,
  type Pane,
  type PaneId,
  type SplitView,
} from "../splitViewStore";

type SplitChatDropPayload = {
  threadId: ThreadId;
  direction: "horizontal" | "vertical";
  side: "first" | "second";
};

const DiffPanel = lazy(() => import("../components/DiffPanel"));
const DIFF_INLINE_LAYOUT_MEDIA_QUERY = "(max-width: 1180px)";
const DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY = "chat_diff_sidebar_width";
const DIFF_INLINE_DEFAULT_WIDTH = "clamp(28rem,48vw,44rem)";
const DIFF_INLINE_SIDEBAR_MIN_WIDTH = 26 * 16;
const COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX = 208;

const DiffPanelSheet = (props: {
  children: ReactNode;
  diffOpen: boolean;
  onCloseDiff: () => void;
}) => {
  return (
    <Sheet
      open={props.diffOpen}
      onOpenChange={(open) => {
        if (!open) {
          props.onCloseDiff();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className="w-[min(88vw,820px)] max-w-[820px] p-0"
      >
        {props.children}
      </SheetPopup>
    </Sheet>
  );
};

const DiffLoadingFallback = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffPanelShell mode={props.mode} header={<DiffPanelHeaderSkeleton />}>
      <DiffPanelLoadingState label="Loading diff viewer..." />
    </DiffPanelShell>
  );
};

const LazyDiffPanel = (props: { mode: DiffPanelMode }) => {
  return (
    <DiffWorkerPoolProvider>
      <Suspense fallback={<DiffLoadingFallback mode={props.mode} />}>
        <DiffPanel mode={props.mode} />
      </Suspense>
    </DiffWorkerPoolProvider>
  );
};

function SplitChatLeaf(props: {
  splitView: SplitView;
  paneId: PaneId;
  threadId: ThreadId | null;
  isFocused: boolean;
  onFocus: (paneId: PaneId, threadId: ThreadId | null) => void;
  onClose: (paneId: PaneId) => void;
  onDrop: (paneId: PaneId, payload: SplitChatDropPayload) => void;
}) {
  const mountedThreadIds = useMemo(
    () =>
      new Set(
        collectLeaves(props.splitView.root).flatMap((leaf) =>
          leaf.threadId ? [leaf.threadId] : [],
        ),
      ),
    [props.splitView.root],
  );

  return (
    <ChatPaneDropOverlay
      paneScopeId={props.paneId}
      excludedThreadIds={mountedThreadIds}
      canDropInDirection={(direction) =>
        canSubdividePane(props.splitView.root, props.paneId, direction)
      }
      onDrop={(payload) => props.onDrop(props.paneId, payload)}
      className={props.isFocused ? "ring-1 ring-inset ring-ring/55" : ""}
    >
      <div
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        onPointerDownCapture={() => props.onFocus(props.paneId, props.threadId)}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-2 top-2 z-40 size-7 bg-background/80 text-muted-foreground shadow-sm backdrop-blur hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            props.onClose(props.paneId);
          }}
          aria-label="Close split pane"
        >
          <XIcon className="size-3.5" />
        </Button>
        {props.threadId ? (
          <ChatView key={props.threadId} threadId={props.threadId} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">
            Drop a chat here
          </div>
        )}
      </div>
    </ChatPaneDropOverlay>
  );
}

function SplitChatTree(props: {
  splitView: SplitView;
  pane: Pane;
  onFocus: (paneId: PaneId, threadId: ThreadId | null) => void;
  onClose: (paneId: PaneId) => void;
  onDrop: (paneId: PaneId, payload: SplitChatDropPayload) => void;
}) {
  if (props.pane.kind === "leaf") {
    return (
      <SplitChatLeaf
        splitView={props.splitView}
        paneId={props.pane.id}
        threadId={props.pane.threadId}
        isFocused={props.splitView.focusedPaneId === props.pane.id}
        onFocus={props.onFocus}
        onClose={props.onClose}
        onDrop={props.onDrop}
      />
    );
  }

  const style = { "--split-ratio": String(props.pane.ratio) } as CSSProperties;
  return (
    <div
      className={
        props.pane.direction === "horizontal"
          ? "flex min-h-0 min-w-0 flex-1 flex-row"
          : "flex min-h-0 min-w-0 flex-1 flex-col"
      }
      style={style}
    >
      <div className="flex min-h-0 min-w-0 flex-1 border-border first:border-0">
        <SplitChatTree {...props} pane={props.pane.first} />
      </div>
      <div
        className={
          props.pane.direction === "horizontal"
            ? "flex min-h-0 min-w-0 flex-1 border-l border-border"
            : "flex min-h-0 min-w-0 flex-1 border-t border-border"
        }
      >
        <SplitChatTree {...props} pane={props.pane.second} />
      </div>
    </div>
  );
}

function SplitChatView(props: { splitView: SplitView; routeThreadId: ThreadId }) {
  const navigate = useNavigate();
  const setFocusedPane = useSplitViewStore((store) => store.setFocusedPane);
  const dropThreadOnPane = useSplitViewStore((store) => store.dropThreadOnPane);
  const removePaneFromSplitView = useSplitViewStore((store) => store.removePaneFromSplitView);

  const focusPane = useCallback(
    (paneId: PaneId, threadId: ThreadId | null) => {
      setFocusedPane(props.splitView.id, paneId);
      if (threadId && threadId !== props.routeThreadId) {
        void navigate({
          to: "/$threadId",
          params: { threadId },
          search: (previous) => ({ ...previous, splitViewId: props.splitView.id }),
        });
      }
    },
    [navigate, props.routeThreadId, props.splitView.id, setFocusedPane],
  );

  const openFocusedPaneAsSingle = useCallback(() => {
    const focusedThreadId = resolveSplitViewFocusedThreadId(props.splitView) ?? props.routeThreadId;
    void navigate({
      to: "/$threadId",
      params: { threadId: focusedThreadId },
      search: (previous) => ({ ...previous, splitViewId: undefined }),
    });
  }, [navigate, props.routeThreadId, props.splitView]);

  const closePane = useCallback(
    (paneId: PaneId) => {
      const closedThreadId = resolveSplitViewPaneThreadId(props.splitView, paneId);
      const didClose = removePaneFromSplitView({ splitViewId: props.splitView.id, paneId });
      if (!didClose) return;
      const nextSplitView = useSplitViewStore.getState().splitViewsById[props.splitView.id] ?? null;
      if (!nextSplitView) {
        const fallbackThreadId =
          collectLeaves(props.splitView.root).find((leaf) => leaf.threadId !== closedThreadId)
            ?.threadId ?? props.routeThreadId;
        void navigate({
          to: "/$threadId",
          params: { threadId: fallbackThreadId },
          search: (previous) => ({ ...previous, splitViewId: undefined }),
        });
        return;
      }
      const focusedThreadId = resolveSplitViewFocusedThreadId(nextSplitView);
      if (focusedThreadId) {
        void navigate({
          to: "/$threadId",
          params: { threadId: focusedThreadId },
          search: (previous) => ({ ...previous, splitViewId: nextSplitView.id }),
        });
      }
    },
    [navigate, props.routeThreadId, props.splitView, removePaneFromSplitView],
  );

  const handleDrop = useCallback(
    (paneId: PaneId, payload: SplitChatDropPayload) => {
      const didDrop = dropThreadOnPane({
        splitViewId: props.splitView.id,
        targetPaneId: paneId,
        direction: payload.direction,
        side: payload.side,
        threadId: payload.threadId,
      });
      if (!didDrop) return;
      void navigate({
        to: "/$threadId",
        params: { threadId: payload.threadId },
        search: (previous) => ({ ...previous, splitViewId: props.splitView.id }),
      });
    },
    [dropThreadOnPane, navigate, props.splitView.id],
  );

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
      <div className="pointer-events-none absolute left-1/2 top-2 z-50 -translate-x-1/2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="pointer-events-auto h-7 bg-background/90 px-2 text-xs shadow-sm backdrop-blur"
          onClick={openFocusedPaneAsSingle}
        >
          Single
        </Button>
      </div>
      <SplitChatTree
        splitView={props.splitView}
        pane={props.splitView.root}
        onFocus={focusPane}
        onClose={closePane}
        onDrop={handleDrop}
      />
    </div>
  );
}

const DiffPanelInlineSidebar = (props: {
  diffOpen: boolean;
  onCloseDiff: () => void;
  onOpenDiff: () => void;
  renderDiffContent: boolean;
}) => {
  const { diffOpen, onCloseDiff, onOpenDiff, renderDiffContent } = props;
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        onOpenDiff();
        return;
      }
      onCloseDiff();
    },
    [onCloseDiff, onOpenDiff],
  );
  const shouldAcceptInlineSidebarWidth = useCallback(
    ({ nextWidth, wrapper }: { nextWidth: number; wrapper: HTMLElement }) => {
      const composerForm = document.querySelector<HTMLElement>("[data-chat-composer-form='true']");
      if (!composerForm) return true;
      const composerViewport = composerForm.parentElement;
      if (!composerViewport) return true;
      const previousSidebarWidth = wrapper.style.getPropertyValue("--sidebar-width");
      wrapper.style.setProperty("--sidebar-width", `${nextWidth}px`);

      const viewportStyle = window.getComputedStyle(composerViewport);
      const viewportPaddingLeft = Number.parseFloat(viewportStyle.paddingLeft) || 0;
      const viewportPaddingRight = Number.parseFloat(viewportStyle.paddingRight) || 0;
      const viewportContentWidth = Math.max(
        0,
        composerViewport.clientWidth - viewportPaddingLeft - viewportPaddingRight,
      );
      const formRect = composerForm.getBoundingClientRect();
      const composerFooter = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-footer='true']",
      );
      const composerRightActions = composerForm.querySelector<HTMLElement>(
        "[data-chat-composer-actions='right']",
      );
      const composerRightActionsWidth = composerRightActions?.getBoundingClientRect().width ?? 0;
      const composerFooterGap = composerFooter
        ? Number.parseFloat(window.getComputedStyle(composerFooter).columnGap) ||
          Number.parseFloat(window.getComputedStyle(composerFooter).gap) ||
          0
        : 0;
      const minimumComposerWidth =
        COMPOSER_COMPACT_MIN_LEFT_CONTROLS_WIDTH_PX + composerRightActionsWidth + composerFooterGap;
      const hasComposerOverflow = composerForm.scrollWidth > composerForm.clientWidth + 0.5;
      const overflowsViewport = formRect.width > viewportContentWidth + 0.5;
      const violatesMinimumComposerWidth = composerForm.clientWidth + 0.5 < minimumComposerWidth;

      if (previousSidebarWidth.length > 0) {
        wrapper.style.setProperty("--sidebar-width", previousSidebarWidth);
      } else {
        wrapper.style.removeProperty("--sidebar-width");
      }

      return !hasComposerOverflow && !overflowsViewport && !violatesMinimumComposerWidth;
    },
    [],
  );

  return (
    <SidebarProvider
      defaultOpen={false}
      open={diffOpen}
      onOpenChange={onOpenChange}
      className="w-auto min-h-0 flex-none bg-transparent"
      style={{ "--sidebar-width": DIFF_INLINE_DEFAULT_WIDTH } as React.CSSProperties}
    >
      <Sidebar
        side="right"
        collapsible="offcanvas"
        className="border-l border-border bg-card text-foreground"
        resizable={{
          minWidth: DIFF_INLINE_SIDEBAR_MIN_WIDTH,
          shouldAcceptWidth: shouldAcceptInlineSidebarWidth,
          storageKey: DIFF_INLINE_SIDEBAR_WIDTH_STORAGE_KEY,
        }}
      >
        {renderDiffContent ? <LazyDiffPanel mode="sidebar" /> : null}
        <SidebarRail />
      </Sidebar>
    </SidebarProvider>
  );
};

function ChatThreadRouteView() {
  const threadsHydrated = useStore((store) => store.threadsHydrated);
  const navigate = useNavigate();
  const threadId = Route.useParams({
    select: (params) => ThreadId.makeUnsafe(params.threadId),
  });
  const search = Route.useSearch();
  const splitView = useSplitViewStore(selectSplitView(search.splitViewId ?? null));
  const activeSplitView =
    splitView && resolveSplitViewThreadIds(splitView).includes(threadId) ? splitView : null;
  const createSplitFromDrop = useSplitViewStore((store) => store.createFromDrop);
  const threadExists = useStore((store) => store.threads.some((thread) => thread.id === threadId));
  const draftThreadExists = useComposerDraftStore((store) =>
    Object.hasOwn(store.draftThreadsByThreadId, threadId),
  );
  const routeThreadExists = threadExists || draftThreadExists;
  const diffOpen = search.diff === "1";
  const shouldUseDiffSheet = useMediaQuery(DIFF_INLINE_LAYOUT_MEDIA_QUERY);
  // TanStack Router keeps active route components mounted across param-only navigations
  // unless remountDeps are configured, so this stays warm across thread switches.
  const [hasOpenedDiff, setHasOpenedDiff] = useState(diffOpen);
  const closeDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: { diff: undefined },
    });
  }, [navigate, threadId]);
  const openDiff = useCallback(() => {
    void navigate({
      to: "/$threadId",
      params: { threadId },
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [navigate, threadId]);
  const handleSinglePaneDrop = useCallback(
    (payload: {
      threadId: ThreadId;
      direction: "horizontal" | "vertical";
      side: "first" | "second";
    }) => {
      if (payload.threadId === threadId) return;
      const splitViewId = createSplitFromDrop({
        sourceThreadId: threadId,
        droppedThreadId: payload.threadId,
        direction: payload.direction,
        side: payload.side,
      });
      void navigate({
        to: "/$threadId",
        params: { threadId: payload.threadId },
        search: (previous) => ({ ...previous, splitViewId }),
      });
    },
    [createSplitFromDrop, navigate, threadId],
  );

  useEffect(() => {
    if (diffOpen) {
      setHasOpenedDiff(true);
    }
  }, [diffOpen]);

  useEffect(() => {
    if (!threadsHydrated) {
      return;
    }

    if (!routeThreadExists) {
      void navigate({ to: "/", replace: true });
      return;
    }
  }, [navigate, routeThreadExists, threadsHydrated, threadId]);

  useEffect(() => {
    if (!search.splitViewId || splitView === null || activeSplitView) {
      return;
    }
    void navigate({
      to: "/$threadId",
      params: { threadId },
      replace: true,
      search: (previous) => ({ ...previous, splitViewId: undefined }),
    });
  }, [activeSplitView, navigate, search.splitViewId, splitView, threadId]);

  if (!threadsHydrated || !routeThreadExists) {
    return null;
  }

  const shouldRenderDiffContent = diffOpen || hasOpenedDiff;
  const chatSurface = activeSplitView ? (
    <SplitChatView splitView={activeSplitView} routeThreadId={threadId} />
  ) : (
    <ChatPaneDropOverlay
      paneScopeId={threadId}
      excludedThreadIds={new Set([threadId])}
      onDrop={handleSinglePaneDrop}
    >
      <ChatView key={threadId} threadId={threadId} />
    </ChatPaneDropOverlay>
  );

  if (!shouldUseDiffSheet) {
    return (
      <>
        <SidebarInset className="h-dvh  min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
          {chatSurface}
        </SidebarInset>
        <DiffPanelInlineSidebar
          diffOpen={diffOpen}
          onCloseDiff={closeDiff}
          onOpenDiff={openDiff}
          renderDiffContent={shouldRenderDiffContent}
        />
      </>
    );
  }

  return (
    <>
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
        {chatSurface}
      </SidebarInset>
      <DiffPanelSheet diffOpen={diffOpen} onCloseDiff={closeDiff}>
        {shouldRenderDiffContent ? <LazyDiffPanel mode="sheet" /> : null}
      </DiffPanelSheet>
    </>
  );
}

export const Route = createFileRoute("/_chat/$threadId")({
  validateSearch: (search) => parseDiffRouteSearch(search),
  search: {
    middlewares: [retainSearchParams<DiffRouteSearch>(["diff", "splitViewId"])],
  },
  component: ChatThreadRouteView,
});
