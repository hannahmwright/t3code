import { Option, Schema } from "effect";
import type { PetCompanionStatusSnapshot, PetCompanionUsageSnapshot } from "@t3tools/contracts";

const withDefaults =
  <
    S extends Schema.Top & Schema.WithoutConstructorDefault,
    D extends S["~type.make.in"] & S["Encoded"],
  >(
    fallback: () => D,
  ) =>
  (schema: S) =>
    schema.pipe(
      Schema.withConstructorDefault(() => Option.some(fallback())),
      Schema.withDecodingDefault(() => fallback()),
    );

export const PET_COMPANION_STORAGE_KEY = "t3code:pet-companion:v2";
export const PET_COMPANION_OPEN_EVENT = "t3code:pet-companion:open";

export async function openPetCompanion(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const togglePetCompanion = window.desktopBridge?.togglePetCompanion;
  if (!togglePetCompanion) return false;
  return togglePetCompanion();
}

export const CodexPetStateId = Schema.Literals([
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
]);
export type CodexPetStateId = typeof CodexPetStateId.Type;

export async function setDesktopPetCompanionState(state: CodexPetStateId): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const setPetCompanionState = window.desktopBridge?.setPetCompanionState;
  if (!setPetCompanionState) return false;
  return setPetCompanionState(state);
}

export async function setDesktopPetCompanionUsage(
  usage: PetCompanionUsageSnapshot | null,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const setPetCompanionUsage = window.desktopBridge?.setPetCompanionUsage;
  if (!setPetCompanionUsage) return false;
  return setPetCompanionUsage(usage);
}

export async function setDesktopPetCompanionStatus(
  status: PetCompanionStatusSnapshot | null,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const setPetCompanionStatus = window.desktopBridge?.setPetCompanionStatus;
  if (!setPetCompanionStatus) return false;
  return setPetCompanionStatus(status);
}

export interface CodexPetState {
  id: CodexPetStateId;
  label: string;
  row: number;
  frames: number;
  durationMs: number;
  purpose: string;
}

export function resolveCodexPetUsageSnapshot(
  rawRateLimits: unknown,
  updatedAt: string,
): PetCompanionUsageSnapshot | null {
  const rateLimits = asRecord(rawRateLimits);
  if (!rateLimits) return null;
  const nestedRateLimits = asRecord(rateLimits.rate_limits);
  const root = nestedRateLimits ?? rateLimits;
  const primary = normalizeUsageBucket(
    root.primary ?? root.primary_window ?? asRecord(root.rate_limit)?.primary,
    "Short",
  );
  const secondary = normalizeUsageBucket(
    root.secondary ?? root.secondary_window ?? asRecord(root.rate_limit)?.secondary,
    "Weekly",
  );
  if (!primary && !secondary) return null;
  return {
    source: "runtime",
    updatedAt,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}

function normalizeUsageBucket(value: unknown, fallbackLabel: string) {
  const bucket = asRecord(value);
  if (!bucket) return null;
  const usedPercent = normalizePercent(
    asNumber(bucket.used_percent) ?? asNumber(bucket.usedPercent),
  );
  const remainingPercent = normalizePercent(
    asNumber(bucket.remaining_percent) ??
      asNumber(bucket.remainingPercent) ??
      (usedPercent !== undefined ? 100 - usedPercent : undefined),
  );
  if (remainingPercent === undefined) return null;

  const label =
    asString(bucket.label) ??
    asString(bucket.name) ??
    asString(bucket.window_label) ??
    asString(bucket.windowLabel) ??
    fallbackLabel;
  const resetsAt = asString(bucket.resets_at) ?? asString(bucket.resetsAt);

  return {
    label,
    remainingPercent,
    ...(usedPercent !== undefined ? { usedPercent } : {}),
    ...(resetsAt ? { resetsAt } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizePercent(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (value > 0 && value <= 1) return Math.round(value * 10_000) / 100;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export const CODEX_PET_STATES: readonly CodexPetState[] = [
  {
    id: "idle",
    label: "Idle",
    row: 0,
    frames: 6,
    durationMs: 1100,
    purpose: "Neutral breathing and blinking loop",
  },
  {
    id: "running-right",
    label: "Run Right",
    row: 1,
    frames: 8,
    durationMs: 1060,
    purpose: "Directional locomotion to the right",
  },
  {
    id: "running-left",
    label: "Run Left",
    row: 2,
    frames: 8,
    durationMs: 1060,
    purpose: "Directional locomotion to the left",
  },
  {
    id: "waving",
    label: "Waving",
    row: 3,
    frames: 4,
    durationMs: 700,
    purpose: "Greeting or attention gesture",
  },
  {
    id: "jumping",
    label: "Jumping",
    row: 4,
    frames: 5,
    durationMs: 840,
    purpose: "Anticipation, lift, peak, descent, settle",
  },
  {
    id: "failed",
    label: "Failed",
    row: 5,
    frames: 8,
    durationMs: 1220,
    purpose: "Readable error or sad reaction",
  },
  {
    id: "waiting",
    label: "Waiting",
    row: 6,
    frames: 6,
    durationMs: 1010,
    purpose: "Patient idle variant",
  },
  {
    id: "running",
    label: "Running",
    row: 7,
    frames: 6,
    durationMs: 820,
    purpose: "Generic in-place run loop",
  },
  {
    id: "review",
    label: "Review",
    row: 8,
    frames: 6,
    durationMs: 1030,
    purpose: "Focused inspecting or thinking loop",
  },
];

export interface CodexPet {
  id: string;
  displayName: string;
  description: string | null;
  spritesheetUrl: string;
}

export interface CodexPetsListResponse {
  petsRoot: string;
  pets: CodexPet[];
}

export const PetCompanionSettingsSchema = Schema.Struct({
  selectedPetId: Schema.NullOr(Schema.String).pipe(withDefaults(() => null)),
  collapsed: Schema.Boolean.pipe(withDefaults(() => false)),
});
export type PetCompanionSettings = typeof PetCompanionSettingsSchema.Type;

export const DEFAULT_PET_COMPANION_SETTINGS = PetCompanionSettingsSchema.makeUnsafe({});

export function resolveCodexPetState(id: CodexPetStateId): CodexPetState {
  return CODEX_PET_STATES.find((state) => state.id === id) ?? CODEX_PET_STATES[0]!;
}

export function selectPetForSettings(
  pets: readonly CodexPet[],
  settings: PetCompanionSettings,
): CodexPet | null {
  if (pets.length === 0) return null;
  return pets.find((pet) => pet.id === settings.selectedPetId) ?? pets[0] ?? null;
}

export function resolvePetStateFromThreadActivity(input: {
  waitingThreadCount: number;
  runningThreadCount: number;
  errorThreadCount: number;
  reviewThreadCount: number;
}): CodexPetStateId {
  if (input.waitingThreadCount > 0) return "waiting";
  if (input.runningThreadCount > 0) return "running";
  if (input.reviewThreadCount > 0) return "review";
  if (input.errorThreadCount > 0) return "failed";
  return "idle";
}

export function resolvePetStatusLabel(input: {
  waitingThreadCount: number;
  runningThreadCount: number;
  errorThreadCount: number;
  reviewThreadCount: number;
}): string {
  if (input.waitingThreadCount > 0) {
    return input.waitingThreadCount > 1
      ? `${input.waitingThreadCount} threads need input`
      : "Needs input";
  }
  if (input.runningThreadCount > 1) {
    return `Running ${input.runningThreadCount} threads`;
  }
  if (input.runningThreadCount === 1) {
    return "Running";
  }
  if (input.reviewThreadCount > 0) {
    return input.reviewThreadCount > 1 ? `${input.reviewThreadCount} threads ready` : "Ready";
  }
  if (input.errorThreadCount > 0) {
    return input.errorThreadCount > 1 ? `${input.errorThreadCount} threads blocked` : "Blocked";
  }
  return "Idle";
}

export function shouldShowPetCompanionStatus(
  state: CodexPetStateId,
): state is Extract<PetCompanionStatusSnapshot["state"], "running" | "waiting"> {
  return state === "running" || state === "waiting";
}
