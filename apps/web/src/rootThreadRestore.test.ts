import { describe, expect, it } from "vitest";

import {
  ACTIVE_THREAD_STORAGE_KEY,
  readStoredActiveThreadId,
  selectStartupThreadId,
  writeStoredActiveThreadId,
} from "./rootThreadRestore";

describe("rootThreadRestore", () => {
  it("prefers the stored active thread when it still exists", () => {
    const selected = selectStartupThreadId(
      {
        threads: [
          {
            id: "thread-1",
            createdAt: "2026-04-15T12:00:00.000Z",
            updatedAt: "2026-04-15T12:10:00.000Z",
            deletedAt: null,
          },
          {
            id: "thread-2",
            createdAt: "2026-04-15T13:00:00.000Z",
            updatedAt: "2026-04-15T13:10:00.000Z",
            deletedAt: null,
          },
        ],
      } as never,
      "thread-1",
    );

    expect(selected).toBe("thread-1");
  });

  it("falls back to the newest active thread when the stored one is missing", () => {
    const selected = selectStartupThreadId(
      {
        threads: [
          {
            id: "thread-1",
            createdAt: "2026-04-15T12:00:00.000Z",
            updatedAt: "2026-04-15T12:10:00.000Z",
            deletedAt: null,
          },
          {
            id: "thread-2",
            createdAt: "2026-04-15T13:00:00.000Z",
            updatedAt: "2026-04-15T13:10:00.000Z",
            deletedAt: null,
          },
          {
            id: "thread-3",
            createdAt: "2026-04-15T14:00:00.000Z",
            updatedAt: "2026-04-15T14:10:00.000Z",
            deletedAt: "2026-04-15T14:11:00.000Z",
          },
        ],
      } as never,
      "thread-9",
    );

    expect(selected).toBe("thread-2");
  });

  it("returns null when there are no active threads", () => {
    const selected = selectStartupThreadId(
      {
        threads: [
          {
            id: "thread-1",
            createdAt: "2026-04-15T12:00:00.000Z",
            updatedAt: "2026-04-15T12:10:00.000Z",
            deletedAt: "2026-04-15T12:11:00.000Z",
          },
        ],
      } as never,
      null,
    );

    expect(selected).toBeNull();
  });

  it("reads and writes the stored active thread id", () => {
    const storage = new Map<string, string>();
    writeStoredActiveThreadId(
      {
        setItem: (key, value) => {
          storage.set(key, value);
        },
      },
      "thread-42",
    );

    expect(storage.get(ACTIVE_THREAD_STORAGE_KEY)).toBe("thread-42");
    expect(
      readStoredActiveThreadId({
        getItem: (key) => storage.get(key) ?? null,
      }),
    ).toBe("thread-42");
  });
});
