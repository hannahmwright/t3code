import type { ServerProvider } from "@t3tools/contracts";
import { Duration, Effect, PubSub, Ref, Scope, Stream } from "effect";
import * as Semaphore from "effect/Semaphore";

import type { ServerProviderShape } from "./Services/ServerProvider";
import { ServerSettingsError } from "@t3tools/contracts";

export const makeManagedServerProvider = Effect.fn("makeManagedServerProvider")(function* <
  Settings,
>(input: {
  readonly getSettings: Effect.Effect<Settings>;
  readonly streamSettings: Stream.Stream<Settings>;
  readonly haveSettingsChanged: (previous: Settings, next: Settings) => boolean;
  readonly makeInitialSnapshot: (settings: Settings) => ServerProvider;
  readonly checkProvider: Effect.Effect<ServerProvider, ServerSettingsError>;
  readonly refreshInterval?: Duration.Input;
}): Effect.fn.Return<ServerProviderShape, ServerSettingsError, Scope.Scope> {
  const refreshSemaphore = yield* Semaphore.make(1);
  const changesPubSub = yield* Effect.acquireRelease(
    PubSub.unbounded<ServerProvider>(),
    PubSub.shutdown,
  );
  const initialSettings = yield* input.getSettings;
  const initialSnapshot = input.makeInitialSnapshot(initialSettings);
  const snapshotRef = yield* Ref.make(initialSnapshot);
  const settingsRef = yield* Ref.make(initialSettings);
  const settingsVersionRef = yield* Ref.make(0);

  const publishSnapshot = Effect.fn("publishSnapshot")(function* (nextSnapshot: ServerProvider) {
    yield* Ref.set(snapshotRef, nextSnapshot);
    yield* PubSub.publish(changesPubSub, nextSnapshot);
    return nextSnapshot;
  });

  const refreshSnapshotBase = Effect.fn("refreshSnapshot")(function* (settingsVersion: number) {
    const nextSnapshot = yield* input.checkProvider;
    const currentSettingsVersion = yield* Ref.get(settingsVersionRef);
    if (currentSettingsVersion !== settingsVersion) {
      return yield* Ref.get(snapshotRef);
    }

    return yield* publishSnapshot(nextSnapshot);
  });
  const refreshSnapshot = (settingsVersion: number) =>
    refreshSemaphore.withPermits(1)(refreshSnapshotBase(settingsVersion));

  const syncSettings = Effect.fn("syncSettings")(function* (nextSettings: Settings) {
    const previousSettings = yield* Ref.get(settingsRef);
    if (!input.haveSettingsChanged(previousSettings, nextSettings)) {
      yield* Ref.set(settingsRef, nextSettings);
      return yield* Ref.get(snapshotRef);
    }

    yield* Ref.set(settingsRef, nextSettings);
    const nextSettingsVersion = yield* Ref.updateAndGet(settingsVersionRef, (version) => version + 1);
    const provisionalSnapshot = input.makeInitialSnapshot(nextSettings);
    yield* publishSnapshot(provisionalSnapshot);
    yield* refreshSnapshot(nextSettingsVersion).pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);
    return provisionalSnapshot;
  });

  const refreshCurrentSnapshot = Effect.fn("refreshCurrentSnapshot")(function* () {
    const nextSettings = yield* input.getSettings;
    yield* Ref.set(settingsRef, nextSettings);
    const settingsVersion = yield* Ref.get(settingsVersionRef);
    return yield* refreshSnapshot(settingsVersion);
  });

  yield* Stream.runForEach(input.streamSettings, (nextSettings) =>
    Effect.asVoid(syncSettings(nextSettings)),
  ).pipe(Effect.forkScoped);

  yield* refreshCurrentSnapshot().pipe(Effect.ignoreCause({ log: true }), Effect.forkScoped);

  yield* Effect.forever(
    Effect.sleep(input.refreshInterval ?? "60 seconds").pipe(
      Effect.flatMap(() => refreshCurrentSnapshot()),
      Effect.ignoreCause({ log: true }),
    ),
  ).pipe(Effect.forkScoped);

  return {
    getSnapshot: input.getSettings.pipe(
      Effect.flatMap(syncSettings),
      Effect.tapError(Effect.logError),
      Effect.orDie,
    ),
    refresh: refreshCurrentSnapshot().pipe(Effect.tapError(Effect.logError), Effect.orDie),
    get streamChanges() {
      return Stream.fromPubSub(changesPubSub);
    },
  } satisfies ServerProviderShape;
});
