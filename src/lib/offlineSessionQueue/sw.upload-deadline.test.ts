/**
 * Issue #907 — the service worker's uploads are aborted after the same
 * deadline as the page's.
 *
 * `public/sw.js` is a plain script with no exports, so this runs the real file
 * in a `node:vm` context that holds only the globals its top level touches, then
 * calls its `postJson` directly.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UPLOAD_TIMEOUT_MS } from "./constants";

const serviceWorkerSource = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");

type Signal = RequestInit["signal"];

/** Loads `public/sw.js` with this `fetch`, on the timers in force when called. */
function loadServiceWorker(fetch: (url: string, init: RequestInit) => Promise<unknown>) {
  const context = vm.createContext({
    self: { addEventListener: () => {} },
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
});
