/**
 * Issue #907 — the service worker's uploads are aborted after the same
 * deadline as the page's. Issue #978 — a permanent answer stops only its own
 * sit, as on the page.
 *
 * `public/sw.js` is a plain script with no exports, so this runs the real file
 * in a `node:vm` context that holds only the globals its top level touches, then
 * calls its `postJson` directly. The `sync` tests fire its listener over an
 * in-memory queue.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { OFFLINE_SYNC_TAG, PARKED_MESSAGE_MAX_LENGTH, UPLOAD_TIMEOUT_MS } from "./constants";

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

type PostOptions = { readBody?: boolean };

/** A copy of the queue, as each IndexedDB read hands out. */
function copyOf(sits: QueuedSit[]): QueuedSit[] {
  return JSON.parse(JSON.stringify(sits)) as QueuedSit[];
}

/** Loads `public/sw.js` with this `fetch`, on the timers in force when called. */
function loadServiceWorker(fetch: (url: string, init: RequestInit) => Promise<unknown>) {
  const listeners = new Map<string, (event: unknown) => void>();
  /** The `type` of each message the worker posts to the tabs. */
  const tabMessages: unknown[] = [];
  /** Each whole message the worker posts to the tabs. */
  const tabMessageBodies: unknown[] = [];
  const matchAll = vi.fn(async () => [
    {
      postMessage: (message: { type?: unknown }) => {
        tabMessages.push(message.type);
        tabMessageBodies.push({ ...message });
      },
    },
  ]);
  const context = vm.createContext({
    self: { addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener) },
    clients: { matchAll },
    fetch,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(serviceWorkerSource, context);
  const postJson = vm.runInContext("postJson", context) as (
    url: string,
    body: unknown,
    options?: PostOptions,
  ) => Promise<unknown>;
  return {
    // Adopted into this realm's Promise, so the matchers see a native one.
    postJson: (url: string, body: unknown, options?: PostOptions) => Promise.resolve(postJson(url, body, options)),
    uploadTimeoutMs: vm.runInContext("UPLOAD_TIMEOUT_MS", context) as unknown,
    parkedMessageMaxLength: vm.runInContext("PARKED_MESSAGE_MAX_LENGTH", context) as unknown,
    tabMessages,
    tabMessageBodies,
    /** The `clients.matchAll` the worker calls to message the tabs. */
    matchAll,
    /** Makes `sits` the worker's queue, signed in as their owner. Returns a copy of each save. */
    useQueue(sits: QueuedSit[]): QueuedSit[][] {
      let stored = copyOf(sits);
      const saves: QueuedSit[][] = [];
      // The worker's function declarations are properties of its context, so
      // these replace its Cache Storage and IndexedDB reads and writes. Each read
      // is a fresh copy, so only a save changes the queue, as in IndexedDB.
      Object.assign(context, {
        readOfflineOwnerUserId: async () => OWNER_USER_ID,
        openOfflineDb: async () => ({ close: () => {} }),
        loadOfflineEntries: async () => copyOf(stored),
        saveOfflineEntries: async (_db: unknown, entries: QueuedSit[]) => {
          stored = copyOf(entries);
          saves.push(copyOf(entries));
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

  test("an upload that skips its body cancels it, so it does not hold the connection", async () => {
    const cancel = vi.fn(async () => {});
    const { postJson } = loadServiceWorker(async () => ({ ok: true, status: 200, body: { cancel }, json: async () => ({}) }));

    await expect(postJson("/api/thoughts/batch", {}, { readBody: false })).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledTimes(1);
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

  test("a sync that sent everything resolves, though telling the tabs fails", async () => {
    const sw = loadServiceWorker(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    const saves = sw.useQueue([queuedSit("answered", true)]);
    sw.matchAll.mockRejectedValue(new Error("clients unavailable"));

    await expect(sw.sync()).resolves.toBeUndefined();
    // Asked once: a failed message is not sent again, and is no reason to retry the sync.
    expect(sw.matchAll).toHaveBeenCalledTimes(1);
    expect(saves).toEqual([[{ ...queuedSit("answered", true), thoughts: [] }]]);
  });

  test("a sync whose upload timed out fails with that error, though telling the tabs fails too", async () => {
    const sw = loadServiceWorker((_url, init) => rejectOnAbort(init.signal));
    sw.useQueue([queuedSit("stalls", false)]);
    sw.matchAll.mockRejectedValue(new Error("clients unavailable"));
    const outcome = sw.sync().then(() => "resolved", (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    expect(((await outcome) as DOMException).name).toBe("AbortError");
    expect(sw.matchAll).toHaveBeenCalledTimes(1);
  });
});

type SentThought = { timeInSession: number; text: string; clientThoughtId?: string };

describe("public/sw.js thought ids (#948)", () => {
  test("a batch the server stored before its upload timed out is sent again with the same ids, and each thought is stored once", async () => {
    const thoughts = [
      { timeInSession: 12, text: "rain", clientThoughtId: "94800000-0000-4000-8000-000000000051" },
      { timeInSession: 30, text: "car door", clientThoughtId: "94800000-0000-4000-8000-000000000052" },
    ];
    const sit = { ...queuedSit("replayed", true), thoughts };
    // Stores each thought once per id, as the route does, before it answers.
    // The first answer never comes.
    const stored: SentThought[] = [];
    const sent: SentThought[][] = [];
    const sw = loadServiceWorker(async (_url, init) => {
      const batch = (JSON.parse(String(init.body)) as { thoughts: SentThought[] }).thoughts;
      sent.push(batch);
      for (const thought of batch) {
        if (!stored.some((t) => t.clientThoughtId === thought.clientThoughtId)) stored.push(thought);
      }
      return sent.length === 1 ? rejectOnAbort(init.signal) : { ok: true, status: 200, json: async () => ({}) };
    });
    const saves = sw.useQueue([sit]);
    const timedOut = sw.sync().then(() => "resolved", (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    // Nothing changed, so nothing was saved: the thoughts are still queued.
    expect(((await timedOut) as DOMException).name).toBe("AbortError");
    expect(saves).toEqual([]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(sent).toEqual([thoughts, thoughts]);
    expect(stored).toEqual(thoughts);
    expect(saves).toEqual([[{ ...sit, thoughts: [] }]]);
  });

  test("an entry queued before ids existed still uploads its thoughts as queued, and clears them", async () => {
    const bodies: unknown[] = [];
    const sw = loadServiceWorker(async (_url, init) => {
      bodies.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, json: async () => ({}) };
    });
    const saves = sw.useQueue([queuedSit("legacy", true)]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(bodies).toEqual([
      { sessionId: "server-legacy", dayNumber: 3, thoughts: [{ timeInSession: 42, text: "a thought in legacy" }] },
    ]);
    expect(saves).toEqual([[{ ...queuedSit("legacy", true), thoughts: [] }]]);
  });
});

describe("public/sw.js end-note clear (#980)", () => {
  /** Records each request's URL and parsed body, answering 2xx. */
  function answeringWorker() {
    const requests: { url: string; body: unknown }[] = [];
    const sw = loadServiceWorker(async (url, init) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: true, status: 200, json: async () => ({}) };
    });
    return { sw, requests };
  }

  test("a synced entry with only a queued clear is uploaded with the flag, which is cleared after a 2xx", async () => {
    const sit = { ...queuedSit("clear-only", true), thoughts: [], clearCompletionNote: true };
    const { sw, requests } = answeringWorker();
    const saves = sw.useQueue([sit]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(requests).toEqual([
      {
        url: "/api/thoughts/batch",
        body: { sessionId: "server-clear-only", dayNumber: 3, thoughts: [], clearCompletionNote: true },
      },
    ]);
    expect(saves).toEqual([[{ ...sit, clearCompletionNote: false }]]);
  });

  test("an entry with thoughts and a queued clear sends both in one batch, and both are cleared after a 2xx", async () => {
    const sit = { ...queuedSit("combined", true), clearCompletionNote: true };
    const { sw, requests } = answeringWorker();
    const saves = sw.useQueue([sit]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(requests).toEqual([
      {
        url: "/api/thoughts/batch",
        body: {
          sessionId: "server-combined",
          dayNumber: 3,
          thoughts: [{ timeInSession: 42, text: "a thought in combined" }],
          clearCompletionNote: true,
        },
      },
    ]);
    expect(saves).toEqual([[{ ...sit, thoughts: [], clearCompletionNote: false }]]);
  });

  test("a clear whose upload fails stays queued, and the sync fails so the browser retries it", async () => {
    const sit = { ...queuedSit("fails", true), thoughts: [], clearCompletionNote: true };
    const sw = loadServiceWorker(async () => ({ ok: false, status: 503, text: async () => "unavailable" }));
    const saves = sw.useQueue([sit]);

    await expect(sw.sync()).rejects.toThrow("unavailable");
    // Nothing changed, so nothing was saved: the flag is still set.
    expect(saves).toEqual([]);
  });

  test("a clear whose upload timed out stays queued", async () => {
    const sit = { ...queuedSit("times-out", true), thoughts: [], clearCompletionNote: true };
    const sw = loadServiceWorker((_url, init) => rejectOnAbort(init.signal));
    const saves = sw.useQueue([sit]);
    const outcome = sw.sync().then(() => "resolved", (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
    expect(((await outcome) as DOMException).name).toBe("AbortError");
    expect(saves).toEqual([]);
  });

  test("a synced entry with no thoughts and no queued clear is not uploaded", async () => {
    const { sw, requests } = answeringWorker();
    const saves = sw.useQueue([{ ...queuedSit("done", true), thoughts: [] }]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(requests).toEqual([]);
    expect(saves).toEqual([]);
  });
});

type RefusedUpload = { status: number; text: string };

/**
 * A `fetch` for `loadServiceWorker` that answers an upload `refuse` names with
 * that status, and every other one with success: a created session is named
 * after its sit. `uploads` lists each upload in order, as `<url> <id>`.
 */
function stubApi(refuse: (url: string, id: string) => RefusedUpload | undefined) {
  const uploads: string[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { clientSessionId?: string; sessionId?: string };
    const id = String(url === "/api/sessions" ? body.clientSessionId : body.sessionId);
    uploads.push(`${url} ${id}`);
    const refused = refuse(url, id);
    if (refused) return { ok: false, status: refused.status, text: async () => refused.text };
    return { ok: true, status: 200, json: async () => ({ session: { id: `server-${id}` } }) };
  };
  return { uploads, fetch };
}

/** A queued sit as the worker leaves it once both of its uploads went through. */
function sentSit(clientSessionId: string) {
  return { ...queuedSit(clientSessionId, true), thoughts: [] };
}

describe("public/sw.js permanent answers (#978)", () => {
  test("keeps as much of a parked sit's answer as the page", () => {
    expect(loadServiceWorker(async () => ({})).parkedMessageMaxLength).toBe(PARKED_MESSAGE_MAX_LENGTH);
  });

  test("a sit the server refuses with a permanent 4xx is parked, and the sits behind it still upload", async () => {
    const api = stubApi((url, id) =>
      url === "/api/sessions" && id === "refused" ? { status: 400, text: '{"error":"Invalid track"}' } : undefined,
    );
    const sw = loadServiceWorker(api.fetch);
    const saves = sw.useQueue([queuedSit("ahead", false), queuedSit("refused", false), queuedSit("behind", false)]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(api.uploads).toEqual([
      "/api/sessions ahead",
      "/api/thoughts/batch server-ahead",
      "/api/sessions refused",
      "/api/sessions behind",
      "/api/thoughts/batch server-behind",
    ]);
    // Kept as it was queued, with the answer that turned it down.
    expect(saves).toEqual([[
      sentSit("ahead"),
      { ...queuedSit("refused", false), parked: { at: expect.any(String), status: 400, message: '{"error":"Invalid track"}' } },
      sentSit("behind"),
    ]]);
    expect(sw.tabMessages).toEqual(["flush-offline-session-queue"]);
  });

  test("a sit whose session row went up before its thoughts were turned down tells the tabs a session synced", async () => {
    const api = stubApi((url) => (url === "/api/thoughts/batch" ? { status: 400, text: '{"error":"Invalid thoughts"}' } : undefined));
    const sw = loadServiceWorker(api.fetch);
    const saves = sw.useQueue([queuedSit("thoughts-refused", false)]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(api.uploads).toEqual(["/api/sessions thoughts-refused", "/api/thoughts/batch server-thoughts-refused"]);
    expect(saves).toEqual([[
      {
        ...queuedSit("thoughts-refused", true),
        parked: { at: expect.any(String), status: 400, message: '{"error":"Invalid thoughts"}' },
      },
    ]]);
    // The tabs skip the parked sit, so only this tells them to refresh progression.
    expect(sw.tabMessageBodies).toEqual([{ type: "flush-offline-session-queue", sessionSynced: true }]);
  });

  test("a sync that sent no session row tells the tabs none synced", async () => {
    const api = stubApi(() => ({ status: 400, text: '{"error":"Invalid track"}' }));
    const sw = loadServiceWorker(api.fetch);
    sw.useQueue([queuedSit("refused", false)]);

    await expect(sw.sync()).resolves.toBeUndefined();

    expect(sw.tabMessageBodies).toEqual([{ type: "flush-offline-session-queue", sessionSynced: false }]);
  });

  test("a parked sit keeps the start of its answer, and no later sync sends it", async () => {
    // A thoughts batch for a session that is gone, answered with a proxy's page.
    const page = `<html><body>${"Session not found. ".repeat(40)}</body></html>`;
    const api = stubApi(() => ({ status: 404, text: page }));
    const sw = loadServiceWorker(api.fetch);
    const saves = sw.useQueue([queuedSit("gone", true)]);

    await expect(sw.sync()).resolves.toBeUndefined();
    await expect(sw.sync()).resolves.toBeUndefined();

    expect(api.uploads).toEqual(["/api/thoughts/batch server-gone"]);
    expect(saves).toEqual([[
      { ...queuedSit("gone", true), parked: { at: expect.any(String), status: 404, message: page.slice(0, PARKED_MESSAGE_MAX_LENGTH) } },
    ]]);
  });

  test.each([401, 403])("a %i leaves its sit queued and fails the sync, so the browser sends it later", async (status) => {
    let signedOut = true;
    const api = stubApi((url, id) =>
      signedOut && url === "/api/sessions" && id === "signed-out" ? { status, text: '{"error":"Unauthorized"}' } : undefined,
    );
    const sw = loadServiceWorker(api.fetch);
    const saves = sw.useQueue([queuedSit("signed-out", false), queuedSit("behind", false)]);

    const refused = await sw.sync().then(() => "resolved", (error: unknown) => error);

    // The sit behind it still uploads; the refused one is saved as it was.
    expect(refused).toHaveProperty("status", status);
    expect(saves).toEqual([[queuedSit("signed-out", false), sentSit("behind")]]);
    expect(sw.tabMessages).toEqual(["flush-offline-session-queue"]);
    // A failed sync still reports the session row the sit behind it sent.
    expect(sw.tabMessageBodies).toEqual([{ type: "flush-offline-session-queue", sessionSynced: true }]);

    signedOut = false;
    await expect(sw.sync()).resolves.toBeUndefined();

    expect(api.uploads).toEqual([
      "/api/sessions signed-out",
      "/api/sessions behind",
      "/api/thoughts/batch server-behind",
      "/api/sessions signed-out",
      "/api/thoughts/batch server-signed-out",
    ]);
    expect(saves.at(-1)).toEqual([sentSit("signed-out"), sentSit("behind")]);
  });

  test.each([
    ["a timeout", (signal: Signal) => rejectOnAbort(signal)],
    ["a network failure", async () => Promise.reject(new TypeError("Failed to fetch"))],
    ["a 503", async () => ({ ok: false, status: 503, text: async () => "" })],
  ])("%s still ends the flush, so the sit behind it is not tried (#907)", async (_name, respond) => {
    const uploads: string[] = [];
    const sw = loadServiceWorker((url, init) => {
      uploads.push(`${url} ${(JSON.parse(String(init.body)) as { clientSessionId: string }).clientSessionId}`);
      return respond(init.signal);
    });
    const saves = sw.useQueue([queuedSit("fails", false), queuedSit("behind", false)]);
    const outcome = sw.sync().then(() => "resolved", (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
    expect(await outcome).not.toBe("resolved");
    expect(uploads).toEqual(["/api/sessions fails"]);
    expect(saves).toEqual([]);
  });
});
