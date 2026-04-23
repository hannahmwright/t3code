import { type DesktopBridge, WS_CHANNELS } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WsTransport } from "./wsTransport";

type WsEventType = "open" | "message" | "close" | "error";
type WsListener = (event?: { data?: unknown }) => void;

const sockets: MockWebSocket[] = [];

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  readonly sent: string[] = [];
  readonly url: string;
  private readonly listeners = new Map<WsEventType, Set<WsListener>>();

  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }

  addEventListener(type: WsEventType, listener: WsListener) {
    const listeners = this.listeners.get(type) ?? new Set<WsListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.emit("close");
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit("open");
  }

  serverMessage(data: unknown) {
    this.emit("message", { data });
  }

  private emit(type: WsEventType, event?: { data?: unknown }) {
    const listeners = this.listeners.get(type);
    if (!listeners) return;
    for (const listener of listeners) {
      listener(event);
    }
  }
}

const originalWebSocket = globalThis.WebSocket;

function getSocket(): MockWebSocket {
  const socket = sockets.at(-1);
  if (!socket) {
    throw new Error("Expected a websocket instance");
  }
  return socket;
}

beforeEach(() => {
  sockets.length = 0;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: {
        protocol: "http:",
        origin: "http://localhost:3020",
        host: "localhost:3020",
        hostname: "localhost",
        port: "3020",
      },
    },
  });
  Reflect.deleteProperty(window, "desktopBridge");

  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.WebSocket = originalWebSocket;
  vi.restoreAllMocks();
});

describe("WsTransport", () => {
  it("prefers a configured primary environment over the desktop bridge default", () => {
    const env = import.meta.env as Record<string, string | undefined>;
    const previousWsUrl = env.VITE_WS_URL;
    env.VITE_WS_URL = "wss://shared.example.com/?token=abc123";
    window.desktopBridge = {
      getWsUrl: () => "ws://127.0.0.1:9000",
    } as DesktopBridge;

    try {
      const transport = new WsTransport();
      const socket = getSocket();
      expect(socket.url).toBe("wss://shared.example.com/?token=abc123");
      transport.dispose();
    } finally {
      env.VITE_WS_URL = previousWsUrl;
      Reflect.deleteProperty(window, "desktopBridge");
    }
  });

  it("routes valid push envelopes to channel listeners", () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 1,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });

    transport.dispose();
  });

  it("resolves pending requests for valid response envelopes", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request("projects.list");
    const sent = socket.sent.at(-1);
    if (!sent) {
      throw new Error("Expected request envelope to be sent");
    }

    const requestEnvelope = JSON.parse(sent) as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });

    transport.dispose();
  });

  it("drops malformed envelopes without crashing transport", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const listener = vi.fn();
    transport.subscribe(WS_CHANNELS.serverConfigUpdated, listener);

    socket.serverMessage("{ invalid-json");
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 2,
        channel: 42,
        data: { bad: true },
      }),
    );
    socket.serverMessage(
      JSON.stringify({
        type: "push",
        sequence: 3,
        channel: WS_CHANNELS.serverConfigUpdated,
        data: { issues: [], providers: [] },
      }),
    );

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.serverConfigUpdated,
      data: { issues: [], providers: [] },
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenNthCalledWith(
      1,
      "Dropped inbound WebSocket envelope",
      "SyntaxError: Expected property name or '}' in JSON at position 2 (line 1 column 3)",
    );
    expect(warnSpy).toHaveBeenNthCalledWith(
      2,
      "Dropped inbound WebSocket envelope",
      expect.stringContaining('Expected "server.configUpdated"'),
    );

    transport.dispose();
  });

  it("queues requests until the websocket opens", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();

    const requestPromise = transport.request("projects.list");
    expect(socket.sent).toHaveLength(0);

    socket.open();
    expect(socket.sent).toHaveLength(1);
    const requestEnvelope = JSON.parse(socket.sent[0] ?? "{}") as { id: string };
    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { projects: [] },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ projects: [] });
    transport.dispose();
  });

  it("does not create a timeout for requests with timeoutMs null", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request(
      "git.runStackedAction",
      { cwd: "/repo" },
      { timeoutMs: null },
    );
    const sent = socket.sent.at(-1);
    if (!sent) {
      throw new Error("Expected request envelope to be sent");
    }
    const requestEnvelope = JSON.parse(sent) as { id: string };

    socket.serverMessage(
      JSON.stringify({
        id: requestEnvelope.id,
        result: { ok: true },
      }),
    );

    await expect(requestPromise).resolves.toEqual({ ok: true });
    expect(timeoutSpy.mock.calls.some(([callback]) => typeof callback === "function")).toBe(false);

    transport.dispose();
  });

  it("rejects pending requests when the websocket closes", async () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    socket.open();

    const requestPromise = transport.request(
      "git.runStackedAction",
      { cwd: "/repo" },
      { timeoutMs: null },
    );

    socket.close();

    await expect(requestPromise).rejects.toThrow("WebSocket connection closed.");
    transport.dispose();
  });

  it("replays the current transport state to late state subscribers", () => {
    const transport = new WsTransport("ws://localhost:3020");
    const socket = getSocket();
    const listener = vi.fn();

    transport.subscribeState(listener, { replayCurrent: true });
    expect(listener).toHaveBeenNthCalledWith(1, "connecting");

    socket.open();

    expect(listener).toHaveBeenNthCalledWith(2, "open");
    transport.dispose();
  });

  it("ignores stale close events after a newer socket reconnects", () => {
    vi.useFakeTimers();

    const transport = new WsTransport("ws://localhost:3020");
    const firstSocket = getSocket();
    firstSocket.open();

    firstSocket.close();
    vi.advanceTimersByTime(500);

    const secondSocket = getSocket();
    expect(secondSocket).not.toBe(firstSocket);
    secondSocket.open();
    expect(transport.getState()).toBe("open");

    firstSocket.close();
    expect(transport.getState()).toBe("open");

    vi.advanceTimersByTime(10_000);
    expect(sockets).toHaveLength(2);

    transport.dispose();
  });
});
