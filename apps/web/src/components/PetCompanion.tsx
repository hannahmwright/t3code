import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import {
  CODEX_PET_STATES,
  DEFAULT_PET_COMPANION_SETTINGS,
  PET_COMPANION_OPEN_EVENT,
  PET_COMPANION_STORAGE_KEY,
  PetCompanionSettingsSchema,
  type CodexPet,
  type CodexPetStateId,
  type CodexPetsListResponse,
  resolveCodexPetState,
  selectPetForSettings,
} from "~/petCompanion";
import { derivePetCompanionRuntimeSnapshot } from "~/petCompanionStatus";
import { useStore } from "~/store";

export function PetCompanion() {
  const [settings, setSettings] = useLocalStorage(
    PET_COMPANION_STORAGE_KEY,
    DEFAULT_PET_COMPANION_SETTINGS,
    PetCompanionSettingsSchema,
  );
  const [petsResponse, setPetsResponse] = useState<CodexPetsListResponse | null>(null);
  const [petsError, setPetsError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { petState, statusLabel } = useStore((store) =>
    derivePetCompanionRuntimeSnapshot(store.threads),
  );
  const pets = petsResponse?.pets ?? [];
  const selectedPet = selectPetForSettings(pets, settings);

  useEffect(() => {
    const abortController = new AbortController();

    setPetsError(null);
    void fetch("/api/pets", {
      cache: "no-store",
      signal: abortController.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Pet list failed with ${response.status}`);
        }
        return (await response.json()) as CodexPetsListResponse;
      })
      .then((response) => {
        setPetsResponse(response);
      })
      .catch((error: unknown) => {
        if (abortController.signal.aborted) return;
        setPetsResponse({ petsRoot: "~/.codex/pets", pets: [] });
        setPetsError(error instanceof Error ? error.message : "Failed to load local pets.");
      });

    return () => abortController.abort();
  }, [refreshNonce]);

  useEffect(() => {
    const handleOpenPetCompanion = () => {
      setSettings((current) => (current.collapsed ? { ...current, collapsed: false } : current));
      setRefreshNonce((current) => current + 1);
      setOpen(true);
    };

    window.addEventListener(PET_COMPANION_OPEN_EVENT, handleOpenPetCompanion);
    return () => window.removeEventListener(PET_COMPANION_OPEN_EVENT, handleOpenPetCompanion);
  }, [setSettings]);

  const toggleCollapsed = () => {
    setSettings((current) => ({ ...current, collapsed: !current.collapsed }));
  };

  const selectPet = (petId: string) => {
    setSettings((current) => ({ ...current, selectedPetId: petId }));
  };

  return (
    <div className="pointer-events-none fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] z-40 sm:right-5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={selectedPet ? `Open ${selectedPet.displayName}` : "Open local pets"}
          className="pointer-events-auto block"
        >
          <div
            className={cn(
              "group flex items-center gap-2 rounded-lg border border-border bg-popover/92 px-2 py-1.5 text-popover-foreground shadow-lg shadow-black/20 backdrop-blur-md transition hover:border-primary/70",
              settings.collapsed ? "px-1.5" : "pr-3",
            )}
          >
            {selectedPet ? (
              <CodexPetSprite
                pet={selectedPet}
                scale={settings.collapsed ? 0.24 : 0.3}
                state={petState}
              />
            ) : (
              <div className="grid size-10 shrink-0 place-items-center rounded-lg border border-dashed border-border bg-muted/40 text-[10px] font-semibold text-muted-foreground">
                PET
              </div>
            )}
            {!settings.collapsed && (
              <div className="min-w-0 text-left">
                <div className="max-w-28 truncate text-xs font-semibold">
                  {selectedPet?.displayName ?? "No local pet"}
                </div>
                <div className="max-w-32 truncate text-[10px] text-muted-foreground">
                  {selectedPet ? statusLabel : "Add one in ~/.codex/pets"}
                </div>
              </div>
            )}
          </div>
        </PopoverTrigger>
        <PopoverPopup
          align="end"
          className="pointer-events-auto w-[min(23rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl shadow-black/20"
          side="top"
          sideOffset={10}
        >
          {selectedPet ? (
            <PetPicker
              pets={pets}
              petState={petState}
              selectedPet={selectedPet}
              statusLabel={statusLabel}
              collapsed={settings.collapsed}
              petsRoot={petsResponse?.petsRoot ?? "~/.codex/pets"}
              onRefresh={() => setRefreshNonce((current) => current + 1)}
              onSelectPet={selectPet}
              onToggleCollapsed={toggleCollapsed}
            />
          ) : (
            <EmptyPetState
              error={petsError}
              petsRoot={petsResponse?.petsRoot ?? "~/.codex/pets"}
              onRefresh={() => setRefreshNonce((current) => current + 1)}
              onToggleCollapsed={toggleCollapsed}
              collapsed={settings.collapsed}
            />
          )}
        </PopoverPopup>
      </Popover>
    </div>
  );
}

function PetPicker({
  pets,
  petState,
  selectedPet,
  statusLabel,
  collapsed,
  petsRoot,
  onRefresh,
  onSelectPet,
  onToggleCollapsed,
}: {
  pets: readonly CodexPet[];
  petState: CodexPetStateId;
  selectedPet: CodexPet;
  statusLabel: string;
  collapsed: boolean;
  petsRoot: string;
  onRefresh: () => void;
  onSelectPet: (petId: string) => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <CodexPetSprite
          className="rounded-md bg-muted/30"
          pet={selectedPet}
          scale={0.48}
          state={petState}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold">{selectedPet.displayName}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{statusLabel}</p>
            </div>
            <Button size="xs" variant="ghost" onClick={onToggleCollapsed}>
              {collapsed ? "Show" : "Tuck"}
            </Button>
          </div>
          {selectedPet.description && (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              {selectedPet.description}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">Local pets</div>
          <Button size="xs" variant="outline" onClick={onRefresh}>
            Refresh
          </Button>
        </div>
        <div className="grid max-h-52 gap-1 overflow-y-auto pr-1">
          {pets.map((pet) => (
            <button
              key={pet.id}
              aria-pressed={pet.id === selectedPet.id}
              className={cn(
                "flex items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition hover:border-border hover:bg-muted/50",
                pet.id === selectedPet.id && "border-primary/60 bg-primary/10",
              )}
              type="button"
              onClick={() => onSelectPet(pet.id)}
            >
              <CodexPetSprite pet={pet} scale={0.18} state="idle" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{pet.displayName}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/30 p-2">
        <div className="text-xs font-medium text-muted-foreground">Sprite rows T3 expects</div>
        <div className="mt-1 flex flex-wrap gap-1">
          {CODEX_PET_STATES.map((state) => (
            <span
              key={state.id}
              className={cn(
                "rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground",
                state.id === petState && "border-primary/60 text-foreground",
              )}
              title={state.purpose}
            >
              {state.label}
            </span>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        T3 reads generated Codex pet packages from <code>{petsRoot}</code>.
      </p>
    </div>
  );
}

function EmptyPetState({
  error,
  petsRoot,
  collapsed,
  onRefresh,
  onToggleCollapsed,
}: {
  error: string | null;
  petsRoot: string;
  collapsed: boolean;
  onRefresh: () => void;
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">No local Codex pet yet</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Add a generated Codex pet package to <code>{petsRoot}</code>, then refresh.
          </p>
        </div>
        <Button size="xs" variant="ghost" onClick={onToggleCollapsed}>
          {collapsed ? "Show" : "Tuck"}
        </Button>
      </div>
      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs">
          {error}
        </p>
      )}
      <div className="rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
        Each pet folder should include <code>pet.json</code> and <code>spritesheet.webp</code> or{" "}
        <code>spritesheet.png</code>. The spritesheet uses 192 by 208 frames across the nine Codex
        state rows.
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
    </div>
  );
}

function CodexPetSprite({
  className,
  pet,
  scale,
  state,
}: {
  className?: string;
  pet: CodexPet;
  scale: number;
  state: CodexPetStateId;
}) {
  const animation = resolveCodexPetState(state);
  const style = {
    "--pet-scale": scale,
    "--sprite-duration": `${animation.durationMs}ms`,
    "--sprite-frames": animation.frames,
    "--sprite-row": animation.row,
    "--sprite-url": `url("${pet.spritesheetUrl}")`,
  } as CSSProperties;

  return (
    <div
      aria-label={`${pet.displayName}: ${animation.label}`}
      className={cn("t3-codex-pet-frame shrink-0", className)}
      role="img"
      style={style}
    >
      <div className="t3-codex-pet-sprite" />
    </div>
  );
}
