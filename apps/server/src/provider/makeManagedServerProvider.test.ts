import type { ServerProvider } from "@t3tools/contracts";
import { Deferred, Effect, PubSub, Ref, Stream } from "effect";
import { describe, expect, it } from "vitest";

import { makeManagedServerProvider } from "./makeManagedServerProvider";

describe("makeManagedServerProvider", () => {
  it("returns an initial snapshot immediately and refreshes provider status in the background", async () => {
    await Effect.scoped(
      Effect.gen(function* () {
        const settings = { enabled: true };
        const settingsChanges = yield* PubSub.unbounded<typeof settings>();
        const probeStarted = yield* Deferred.make<void>();
        const releaseProbe = yield* Deferred.make<void>();
        const probeCalls = yield* Ref.make(0);

        const initialSnapshot: ServerProvider = {
          provider: "codex",
          enabled: true,
          installed: true,
          version: null,
          status: "ready",
          auth: { status: "unknown" },
          checkedAt: "2026-04-10T00:00:00.000Z",
          message: "Checking Codex provider status in the background.",
          models: [],
        };
        const refreshedSnapshot: ServerProvider = {
          ...initialSnapshot,
          version: "1.0.0",
          auth: { status: "authenticated" },
          checkedAt: "2026-04-10T00:00:01.000Z",
        };

        const provider = yield* makeManagedServerProvider({
          getSettings: Effect.succeed(settings),
          streamSettings: Stream.fromPubSub(settingsChanges),
          haveSettingsChanged: (previous, next) => previous.enabled !== next.enabled,
          makeInitialSnapshot: () => initialSnapshot,
          checkProvider: Effect.gen(function* () {
            yield* Ref.update(probeCalls, (count) => count + 1);
            yield* Deferred.succeed(probeStarted, undefined).pipe(Effect.orDie);
            yield* Deferred.await(releaseProbe);
            return refreshedSnapshot;
          }),
          refreshInterval: "1 hour",
        });

        yield* Deferred.await(probeStarted);

        const snapshotBeforeRefresh = yield* provider.getSnapshot;
        const checkCallsBeforeRefresh = yield* Ref.get(probeCalls);
        yield* Effect.sync(() => {
          expect(snapshotBeforeRefresh).toEqual(initialSnapshot);
          expect(checkCallsBeforeRefresh).toBe(1);
        });

        yield* Deferred.succeed(releaseProbe, undefined).pipe(Effect.orDie);

        for (let attempt = 0; attempt < 20; attempt += 1) {
          const snapshot = yield* provider.getSnapshot;
          if (snapshot.auth.status === "authenticated") {
            const checkCallsAfterRefresh = yield* Ref.get(probeCalls);
            yield* Effect.sync(() => {
              expect(snapshot).toEqual(refreshedSnapshot);
              expect(checkCallsAfterRefresh).toBe(1);
            });
            return;
          }
          yield* Effect.sleep("1 millis");
        }

        yield* Effect.sync(() => {
          throw new Error("background provider refresh did not complete");
        });
      }),
    ).pipe(Effect.runPromise);
  });
});
