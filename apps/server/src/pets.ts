import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CODEX_PETS_ROUTE_PREFIX = "/api/pets";
export const CODEX_PET_SPRITESHEET_FILENAMES = [
  "spritesheet.webp",
  "spritesheet.png",
  "sprite.webp",
  "sprite.png",
] as const;

const SAFE_PET_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export interface LocalCodexPet {
  id: string;
  displayName: string;
  description: string | null;
  spritesheetPath: string;
  spritesheetMtimeMs: number;
}

export interface CodexPetsListResponse {
  petsRoot: string;
  pets: Array<{
    id: string;
    displayName: string;
    description: string | null;
    spritesheetUrl: string;
  }>;
}

interface PetJson {
  id?: unknown;
  displayName?: unknown;
  description?: unknown;
  spritesheetPath?: unknown;
}

export function resolveCodexPetsRoot(homeDir: string = os.homedir()): string {
  return path.join(homeDir, ".codex", "pets");
}

export function isSafeCodexPetId(id: string): boolean {
  return SAFE_PET_ID_PATTERN.test(id);
}

function safeRelativeAssetPath(candidate: unknown): string | null {
  if (typeof candidate !== "string" || candidate.trim().length === 0) {
    return null;
  }
  const normalized = candidate.trim().replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }
  return normalized;
}

function resolveWithinRoot(root: string, relativePath: string): string | null {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return resolvedPath;
  }
  return null;
}

function readPetJson(petDir: string): PetJson {
  const petJsonPath = path.join(petDir, "pet.json");
  try {
    return JSON.parse(fs.readFileSync(petJsonPath, "utf8")) as PetJson;
  } catch {
    return {};
  }
}

function findSpritesheetPath(petDir: string, manifest: PetJson): string | null {
  const manifestPath = safeRelativeAssetPath(manifest.spritesheetPath);
  const candidates = manifestPath
    ? [manifestPath, ...CODEX_PET_SPRITESHEET_FILENAMES]
    : CODEX_PET_SPRITESHEET_FILENAMES;
  for (const candidate of candidates) {
    const filePath = resolveWithinRoot(petDir, candidate);
    if (!filePath) continue;
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        return filePath;
      }
    } catch {
      // Keep looking for a compatible sprite filename.
    }
  }
  return null;
}

export function listLocalCodexPets(petsRoot: string = resolveCodexPetsRoot()): LocalCodexPet[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(petsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const pets: LocalCodexPet[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeCodexPetId(entry.name)) {
      continue;
    }

    const petDir = resolveWithinRoot(petsRoot, entry.name);
    if (!petDir) continue;
    const manifest = readPetJson(petDir);
    const manifestId =
      typeof manifest.id === "string" && isSafeCodexPetId(manifest.id) ? manifest.id : entry.name;
    const spritesheetPath = findSpritesheetPath(petDir, manifest);
    if (!spritesheetPath) continue;
    const spriteStat = fs.statSync(spritesheetPath);

    pets.push({
      id: manifestId,
      displayName:
        typeof manifest.displayName === "string" && manifest.displayName.trim().length > 0
          ? manifest.displayName.trim()
          : manifestId,
      description:
        typeof manifest.description === "string" && manifest.description.trim().length > 0
          ? manifest.description.trim()
          : null,
      spritesheetPath,
      spritesheetMtimeMs: Math.floor(spriteStat.mtimeMs),
    });
  }

  return pets.toSorted((a, b) => a.displayName.localeCompare(b.displayName));
}

export function resolveLocalCodexPetSpritesheetPath(input: {
  petsRoot?: string;
  petId: string;
}): string | null {
  if (!isSafeCodexPetId(input.petId)) return null;
  const petsRoot = input.petsRoot ?? resolveCodexPetsRoot();
  return (
    listLocalCodexPets(petsRoot).find((pet) => pet.id === input.petId)?.spritesheetPath ?? null
  );
}

export function buildCodexPetsListResponse(
  petsRoot: string = resolveCodexPetsRoot(),
): CodexPetsListResponse {
  return {
    petsRoot,
    pets: listLocalCodexPets(petsRoot).map((pet) => localPetToResponsePet(pet)),
  };
}

function localPetToResponsePet(pet: LocalCodexPet): CodexPetsListResponse["pets"][number] {
  return {
    id: pet.id,
    displayName: pet.displayName,
    description: pet.description,
    spritesheetUrl: `${CODEX_PETS_ROUTE_PREFIX}/${encodeURIComponent(pet.id)}/spritesheet?v=${pet.spritesheetMtimeMs}`,
  };
}
