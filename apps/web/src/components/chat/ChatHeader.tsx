import {
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { memo } from "react";
import GitActionsControl from "../GitActionsControl";
import { DiffIcon, SettingsIcon, SquarePenIcon, TerminalSquareIcon } from "lucide-react";
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, { type NewProjectScriptInput } from "../ProjectScriptsControl";
import { Toggle } from "../ui/toggle";
import { SidebarTrigger } from "../ui/sidebar";
import { OpenInPicker } from "./OpenInPicker";
import { Button } from "../ui/button";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { SlowRpcAckIndicator } from "../SlowRpcAckIndicator";

interface ChatHeaderProps {
  activeThreadId: ThreadId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  isGitRepo: boolean;
  openInCwd: string | null;
  activeProjectScripts: ProjectScript[] | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  terminalAvailable: boolean;
  terminalOpen: boolean;
  runningTerminalCount: number;
  terminalToggleShortcutLabel: string | null;
  diffToggleShortcutLabel: string | null;
  gitCwd: string | null;
  diffOpen: boolean;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<void>;
  onUpdateProjectScript: (scriptId: string, input: NewProjectScriptInput) => Promise<void>;
  onDeleteProjectScript: (scriptId: string) => Promise<void>;
  onToggleTerminal: () => void;
  onToggleDiff: () => void;
  onNewThread: () => void;
  onOpenSettings: () => void;
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadId,
  activeThreadTitle,
  activeProjectName,
  isGitRepo,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  terminalAvailable,
  terminalOpen,
  runningTerminalCount,
  terminalToggleShortcutLabel,
  diffToggleShortcutLabel,
  gitCwd,
  diffOpen,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  onToggleTerminal,
  onToggleDiff,
  onNewThread,
  onOpenSettings,
}: ChatHeaderProps) {
  const isMobile = useIsMobile();
  const runningTerminalLabel =
    runningTerminalCount === 1 ? "1 running terminal" : `${runningTerminalCount} running terminals`;
  const terminalTooltipLabel = !terminalAvailable
    ? "Terminal is unavailable until this thread has an active project."
    : terminalToggleShortcutLabel
      ? `Toggle terminal drawer (${terminalToggleShortcutLabel})`
      : "Toggle terminal drawer";
  const terminalAriaLabel =
    runningTerminalCount > 0
      ? `Toggle terminal drawer, ${runningTerminalLabel}`
      : "Toggle terminal drawer";

  if (isMobile) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <SidebarTrigger className="mt-0.5 size-11 shrink-0 rounded-full border border-border/70 bg-background/85 shadow-sm" />
          <div className="min-w-0 flex-1">
            {activeProjectName ? (
              <p className="truncate text-xs font-semibold tracking-[0.16em] text-muted-foreground/75 uppercase">
                {activeProjectName}
              </p>
            ) : null}
            <h2
              className="truncate pt-0.5 text-[17px] font-semibold leading-tight text-foreground"
              title={activeThreadTitle}
            >
              {activeThreadTitle}
            </h2>
            {activeProjectName && !isGitRepo ? (
              <span className="mt-1 inline-flex rounded-full bg-amber-500/12 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
                No Git
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SlowRpcAckIndicator />
            <Button
              size="icon-sm"
              variant="outline"
              className="size-11 rounded-full"
              aria-label="New thread"
              title="New thread"
              disabled={!activeProjectName}
              onClick={onNewThread}
            >
              <SquarePenIcon className="size-4.5" />
            </Button>
            <Button
              size="icon-sm"
              variant="outline"
              className="size-11 rounded-full"
              aria-label="Open settings"
              title="Open settings"
              onClick={onOpenSettings}
            >
              <SettingsIcon className="size-4.5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {activeProjectScripts ? (
            <div className="shrink-0">
              <ProjectScriptsControl
                scripts={activeProjectScripts}
                keybindings={keybindings}
                preferredScriptId={preferredScriptId}
                allowAddScript={false}
                onRunScript={onRunProjectScript}
                onAddScript={onAddProjectScript}
                onUpdateScript={onUpdateProjectScript}
                onDeleteScript={onDeleteProjectScript}
              />
            </div>
          ) : null}
          {activeProjectName ? (
            <div className="shrink-0">
              <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="@container/header-actions flex min-w-0 flex-1 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden sm:gap-3">
        <SidebarTrigger className="size-7 shrink-0 md:hidden" />
        <h2
          className="min-w-0 shrink truncate text-sm font-medium text-foreground"
          title={activeThreadTitle}
        >
          {activeThreadTitle}
        </h2>
        {activeProjectName && (
          <Badge variant="outline" className="min-w-0 shrink overflow-hidden">
            <span className="min-w-0 truncate">{activeProjectName}</span>
          </Badge>
        )}
        {activeProjectName && !isGitRepo && (
          <Badge variant="outline" className="shrink-0 text-[10px] text-amber-700">
            No Git
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 @3xl/header-actions:gap-3">
        <SlowRpcAckIndicator />
        {activeProjectScripts && (
          <ProjectScriptsControl
            scripts={activeProjectScripts}
            keybindings={keybindings}
            preferredScriptId={preferredScriptId}
            onRunScript={onRunProjectScript}
            onAddScript={onAddProjectScript}
            onUpdateScript={onUpdateProjectScript}
            onDeleteScript={onDeleteProjectScript}
          />
        )}
        {activeProjectName && (
          <OpenInPicker
            keybindings={keybindings}
            availableEditors={availableEditors}
            openInCwd={openInCwd}
          />
        )}
        {activeProjectName && <GitActionsControl gitCwd={gitCwd} activeThreadId={activeThreadId} />}
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={terminalOpen}
                onPressedChange={onToggleTerminal}
                aria-label={terminalAriaLabel}
                variant="outline"
                size="xs"
                disabled={!terminalAvailable}
              >
                <span className="relative inline-flex items-center justify-center">
                  <TerminalSquareIcon className="size-3" />
                  {runningTerminalCount > 0 ? (
                    <span className="absolute -top-1.5 -right-1.5 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-background bg-emerald-500 px-0.5 text-[8px] leading-none font-semibold text-white shadow-sm">
                      {runningTerminalCount > 9 ? "9+" : runningTerminalCount}
                    </span>
                  ) : null}
                </span>
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {runningTerminalCount > 0
              ? `${terminalTooltipLabel} • ${runningTerminalLabel}`
              : terminalTooltipLabel}
          </TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Toggle
                className="shrink-0"
                pressed={diffOpen}
                onPressedChange={onToggleDiff}
                aria-label="Toggle diff panel"
                variant="outline"
                size="xs"
                disabled={!isGitRepo}
              >
                <DiffIcon className="size-3" />
              </Toggle>
            }
          />
          <TooltipPopup side="bottom">
            {!isGitRepo
              ? "Diff panel is unavailable because this project is not a git repository."
              : diffToggleShortcutLabel
                ? `Toggle diff panel (${diffToggleShortcutLabel})`
                : "Toggle diff panel"}
          </TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
});
