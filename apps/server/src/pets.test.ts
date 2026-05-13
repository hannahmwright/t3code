import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildCodexPetsListResponse,
  listLocalCodexPets,
  resolveLocalCodexPetSpritesheetPath,
} from "./pets";

function makeTempPetsRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "t3code-codex-pets-"));
}

describe("codex pets", () => {
  it("lists Codex-compatible local pet packages", () => {
    const petsRoot = makeTempPetsRoot();
    const petDir = path.join(petsRoot, "boba");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(
      path.join(petDir, "pet.json"),
      JSON.stringify({
        id: "boba",
        displayName: "Boba",
        description: "Tiny otter",
        spritesheetPath: "spritesheet.webp",
      }),
    );
    fs.writeFileSync(path.join(petDir, "spritesheet.webp"), "sprite");

    expect(listLocalCodexPets(petsRoot)).toMatchObject([
      {
        id: "boba",
        displayName: "Boba",
        description: "Tiny otter",
      },
    ]);
    expect(buildCodexPetsListResponse(petsRoot).pets[0]?.spritesheetUrl).toMatch(
      /^\/api\/pets\/boba\/spritesheet\?v=\d+$/,
    );
  });

  it("rejects unsafe pet ids and traversal sprite paths", () => {
    const petsRoot = makeTempPetsRoot();
    const petDir = path.join(petsRoot, "bad");
    fs.mkdirSync(petDir, { recursive: true });
    fs.writeFileSync(
      path.join(petDir, "pet.json"),
      JSON.stringify({ id: "../bad", spritesheetPath: "../secret.webp" }),
    );
    fs.writeFileSync(path.join(petsRoot, "secret.webp"), "sprite");

    expect(listLocalCodexPets(petsRoot)).toEqual([]);
    expect(resolveLocalCodexPetSpritesheetPath({ petsRoot, petId: "../bad" })).toBeNull();
  });
});
