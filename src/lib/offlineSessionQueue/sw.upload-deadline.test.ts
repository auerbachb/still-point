/**
 * Issue #907 — the service worker's uploads are aborted after the same
 * deadline as the page's.
 *
 * `public/sw.js` is a plain script with no exports, so this runs the real file
 * in a `node:vm` context that holds only the globals its top level touches, then
 * calls its `postJson` directly. The `sync` tests fire its listener over an
 * in-memory queue.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OFFLINE_SYNC_TAG, UPLOAD_TIMEOUT_MS } from "./constants";

const serviceWorkerSource = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

type Signal = RequestInit["signal"];

const OWNER_USER_ID = "user-907";

/** A queued sit with one thought. A `sessionSynced` one already has its server row. */
function queuedSit(clientSessionId: string, sessionSynced: boolean) {
  return {
    clientSessionId,
    ownerUserId: OWNER_USER_ID,
    request: { clientSessionId, dayNumber: 3 },
    thoughts: [{ timeInSession: 42, text: `a thought in ${clientSessionId}` }],
    serverSessionId: sessionSynced ? `server-${clientSessionId}` : null,
    sessionSynced,
  };
}

type QueuedSit = ReturnType<typeof queuedSit>;

/** Loads `public/sw.js` with this `fetch`, on the timers in force when called. */
function loadServiceWorker(fetch: (url: string, init: RequestInit) => Promise<unknown>) {
  const listeners = new Map<string, (event: unknown) => void>();
  /** The `type` of each message the worker posts to the tabs. */
  const tabMessages: unknown[] = [];
  const context = vm.createContext({
    self: { addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener) },
    clients: { matchAll: async () => [{ postMessage: (message: { type?: unknown }) => tabMessages.push(message.type) }] },
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(serviceWorkerSource, context);
  const postJson = vm.runInContext("postJson", context) as (url: string, body: unknown) => Promise<unknown>;
  return {
    // Adopted into this realm's Promise, so the matchers see a native one.
    postJson: (url: string, body: unknown) => Promise.resolve(postJson(url, body)),
    uploadTimeoutMs: vm.runInContext("UPLOAD_TIMEOUT_MS", context) as unknown,
    tabMessages,
    /** Makes `sits` the worker's queue, signed in as their owner. Returns a copy of each save. */
    useQueue(sits: QueuedSit[]): QueuedSit[][] {
      const saves: QueuedSit[][] = [];
      // The worker's function declarations are properties of its context, so
      // these replace its Cache Storage and IndexedDB reads and writes.
      Object.assign(context, {
        readOfflineOwnerUserId: async () => OWNER_USER_ID,
        openOfflineDb: async () => ({ close: () => {} }),
        loadOfflineEntries: async () => sits,
        saveOfflineEntries: async (_db: unknown, entries: QueuedSit[]) => {
          saves.push(JSON.parse(JSON.stringify(entries)) as QueuedSit[]);
        },
      });
      return saves;
    },
    /** Fires the worker's `sync` listener. Settles as the promise it hands `waitUntil` does. */
    sync(): Promise<unknown> {
      const listener = listeners.get("sync");
      if (!listener) throw new Error("public/sw.js added no sync listener");
      let waited: unknown;
      listener({ tag: OFFLINE_SYNC_TAG, waitUntil: (promise: unknown) => (waited = promise) });
      return Promise.resolve(waited);
    },
  };
}

/** Settles only once `signal` aborts, rejecting the way `fetch` and body reads
 *  do then. With no signal, it never settles. */
function rejectOnAbort(signal: Signal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("public/sw.js upload deadline (#907)", () => {
  test("is the page's deadline", () => {
    expect(loadServiceWorker(async () => ({})).uploadTimeoutMs).toBe(UPLOAD_TIMEOUT_MS);
  });

  test("an upload with no answer is aborted at the deadline", async () => {
    const signals: Signal[] = [];
    const { postJson } = loadServiceWorker((_url, init) => {
      signals.push(init.signal);
      return rejectOnAbort(init.signal);
    });
    const result = postJson("/api/thoughts/batch", { thoughts: [] }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    const error = await result;
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
  });

  test("a response body that stalls after its headers is aborted too", async () => {
    const signals: Signal[] = [];
    const { postJson } = loadServiceWorker(async (_url, init) => {
      signals.push(init.signal);
      return { ok: true, status: 200, json: () => rejectOnAbort(init.signal) };
    });
    const result = postJson("/api/sessions", {}).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    // Holds only while `postJson` awaits the body inside its `try`: returned
    // un-awaited, its `finally` would clear the deadline before the read.
    expect(signals[0]?.aborted).toBe(true);
    expect(((await result) as DOMException).name).toBe("AbortError");
  });

  test("an upload that succeeds returns its body and clears its deadline", async () => {
    const body = { session: { id: "server-907" } };
    const { postJson } = loadServiceWorker(async () => ({ ok: true, status: 200, json: async () => body }));

    await expect(postJson("/api/sessions", {})).resolves.toEqual(body);
    expect(vi.getTimerCount()).toBe(0);
  });

  test("a sync whose upload timed out keeps what it sent, tells the tabs and fails, so the browser retries it", async () => {
    const sw = loadServiceWorker(async (url, init) =>
      url === "/api/sessions" ? rejectOnAbort(init.signal) : { ok: true, status: 200, json: async () => ({}) },
    );
    const saves = sw.useQueue([queuedSit("sent-first", true), queuedSit("stalls", false)]);
    const outcome = sw.sync().then(() => "resolved", (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    expect(((await outcome) as DOMException).name).toBe("AbortError");
    // The first sit's batch is stored as sent, so the retry cannot send it again.
    // The sit whose upload stalled is still queued as it was.
    expect(saves).toEqual([[{ ...queuedSit("sent-first", true), thoughts: [] }, queuedSit("stalls", false)]]);
    expect(sw.tabMessages).toEqual(["flush-offline-session-queue"]);
  });

  test("a thoughts batch is sent once the server answers, though its body stalls", async () => {
    const sw = loadServiceWorker(async (_url, init) => ({ ok: true, status: 200, json: () => rejectOnAbort(init.signal) }));
    const saves = sw.useQueue([queuedSit("answered", true)]);
    const outcome = sw.sync().then(() => "resolved", (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    expect(await outcome).toBe("resolved");
    expect(saves).toEqual([[{ ...queuedSit("answered", true), thoughts: [] }]]);
    expect(sw.tabMessages).toEqual(["flush-offline-session-queue"]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
