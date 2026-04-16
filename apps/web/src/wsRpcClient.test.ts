import {
  GitStatusLocalResult,
  GitStatusRemoteResult,
  GitStatusStreamEvent,
  WS_METHODS,
} from "@t3tools/contracts";
import { Duration, Option, Stream } from "effect";
import { describe, expect, it, vi } from "vitest";

import { createWsRpcClient } from "./wsRpcClient";
import { type WsTransport } from "./wsTransport";

const baseLocalStatus: GitStatusLocalResult = {
  isRepo: true,
  hasOriginRemote: true,
  isDefaultBranch: false,
  branch: "feature/demo",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
};

const baseRemoteStatus: GitStatusRemoteResult = {
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

type TransportRequestOptions = Parameters<WsTransport["request"]>[1];

describe("wsRpcClient", () => {
  it("reduces git status stream events into flat status snapshots", () => {
    const subscribe = vi.fn(<TValue>(_connect: unknown, listener: (value: TValue) => void) => {
      for (const event of [
        {
          _tag: "snapshot",
          local: baseLocalStatus,
          remote: null,
        },
        {
          _tag: "remoteUpdated",
          remote: baseRemoteStatus,
        },
        {
          _tag: "localUpdated",
          local: {
            ...baseLocalStatus,
            hasWorkingTreeChanges: true,
          },
        },
      ] satisfies GitStatusStreamEvent[]) {
        listener(event as TValue);
      }
      return () => undefined;
    });

    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe: subscribe as unknown as WsTransport["subscribe"],
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);
    const listener = vi.fn();

    client.git.onStatus({ cwd: "/repo" }, listener);

    expect(listener.mock.calls).toEqual([
      [
        {
          ...baseLocalStatus,
          hasUpstream: false,
          aheadCount: 0,
          behindCount: 0,
          pr: null,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
        },
      ],
      [
        {
          ...baseLocalStatus,
          ...baseRemoteStatus,
          hasWorkingTreeChanges: true,
        },
      ],
    ]);
  });

  it("applies timeout-backed recovery to orchestration dispatches", async () => {
    let capturedOptions: TransportRequestOptions | undefined;
    const request = vi.fn(
      async (
        _execute: Parameters<WsTransport["request"]>[0],
        options?: TransportRequestOptions,
      ) => {
        capturedOptions = options;
        return { sequence: 1 };
      },
    );
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: request as unknown as WsTransport["request"],
      requestStream: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);

    await client.orchestration.dispatchCommand({} as never);

    expect(request).toHaveBeenCalledTimes(1);
    const options = capturedOptions;
    expect(options).toBeDefined();
    if (!options) {
      throw new Error("Expected dispatch timeout options.");
    }
    expect(options.recoverOnTimeout).toBe(true);
    expect(options.timeoutMessage).toContain("Timed out waiting for the T3 server");
    expect(options.timeout).toBeDefined();
    if (!options.timeout || !Option.isSome(options.timeout)) {
      throw new Error("Expected a dispatch timeout.");
    }
    expect(Duration.toMillis(Duration.fromInputUnsafe(options.timeout.value))).toBe(20_000);
  });

  it("re-subscribes orchestration domain events from the latest client sequence", () => {
    let latestSequence = 7;
    const requestedSequences: number[] = [];
    const subscribe: WsTransport["subscribe"] = (connect, _listener) => {
      const client = {
        [WS_METHODS.subscribeOrchestrationDomainEvents]: (input: {
          fromSequenceExclusive: number;
        }) => {
          requestedSequences.push(input.fromSequenceExclusive);
          return Stream.empty;
        },
      } as unknown as Parameters<typeof connect>[0];

      connect(client);
      latestSequence = 11;
      connect(client);

      return () => undefined;
    };
    const transport = {
      dispose: vi.fn(async () => undefined),
      reconnect: vi.fn(async () => undefined),
      request: vi.fn(),
      requestStream: vi.fn(),
      subscribe,
    } satisfies Pick<
      WsTransport,
      "dispose" | "reconnect" | "request" | "requestStream" | "subscribe"
    >;

    const client = createWsRpcClient(transport as unknown as WsTransport);

    client.orchestration.onDomainEvent(vi.fn(), {
      getFromSequenceExclusive: () => latestSequence,
    });

    expect(requestedSequences).toEqual([7, 11]);
  });
});
