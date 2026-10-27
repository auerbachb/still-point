/**
 * Issue #907 — each live upload is aborted after `UPLOAD_TIMEOUT_MS`.
 *
 * Uploads run inside the queue lock every tab shares (#834), so the deadline is
 * what bounds how long a stalled one keeps the other queue writes waiting.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UPLOAD_TIMEOUT_MS } from "./constants";
import {
  failureStatus,
  isNetworkFailure,
  isPermanentFailure,
  liveSessionSyncTransport,
  type SessionSyncTransport,
} from "./transport";
import type { CreateSessionPayload } from "./types";

const payload: CreateSessionPayload = {
  dayNumber: 1,
  sessionType: "standard",
  duration: 60,
  completed: true,
  actualTime: 60,
  clearPercent: 100,
  thoughtCount: 0,
  mindStateLog: [],
  sessionDate: "2026-10-26",
  clientSessionId: "550e8400-e29b-41d4-a716-446655440907",
};

const batch = {
  sessionId: "server-907",
  dayNumber: 1,
  thoughts: [{ timeInSession: -1, text: "a long note" }],
};

const uploads: Array<[string, (transport: SessionSyncTransport) => Promise<unknown>]> = [
  ["createSession", (transport) => transport.createSession(payload)],
  ["batchThoughts", (transport) => transport.batchThoughts(batch)],
];

type Signal = RequestInit["signal"];

/** Settles only once `signal` aborts, rejecting the way `fetch` and body reads
 *  do then. With no signal, it never settles. */
function rejectOnAbort(signal: Signal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
}

/** Stubs `fetch` with `respond`, and returns the signal each call was given. */
function stubFetch(respond: (signal: Signal) => Promise<unknown>): Signal[] {
  const signals: Signal[] = [];
  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
    signals.push(init.signal);
    return respond(init.signal);
  }));
  return signals;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("liveSessionSyncTransport upload deadline (#907)", () => {
  test.each(uploads)("%s with no answer is aborted at the deadline, as a retryable failure", async (_name, upload) => {
    const signals = stubFetch(rejectOnAbort);
    const result = upload(liveSessionSyncTransport()).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS - 1);
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(signals[0]?.aborted).toBe(true);
    const error = await result;
    expect(error).toMatchObject({ message: "Upload timed out", retryable: true });
    expect(isNetworkFailure(error)).toBe(true);
  });

  test("a response body that stalls after its headers is aborted too", async () => {
    const signals = stubFetch(async (signal) => ({ ok: true, status: 201, json: () => rejectOnAbort(signal) }));
    const result = liveSessionSyncTransport().createSession(payload).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    expect(signals[0]?.aborted).toBe(true);
    const error = await result;
    expect(error).toMatchObject({ message: "Upload timed out", retryable: true });
    expect(isNetworkFailure(error)).toBe(true);
  });

  test("a failure classified by its status keeps that class when the deadline cuts its body short", async () => {
    const signals = stubFetch(async (signal) => ({ ok: false, status: 400, text: () => rejectOnAbort(signal) }));
    const result = liveSessionSyncTransport().batchThoughts(batch).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);

    expect(signals[0]?.aborted).toBe(true);
    const error = await result;
    expect(error).toMatchObject({ message: "Batch thoughts failed (400)", permanent: true });
    expect(isNetworkFailure(error)).toBe(false);
  });

  test.each(uploads)("%s that succeeds clears its deadline", async (_name, upload) => {
    const signals = stubFetch(async () => ({ ok: true, status: 201, json: async () => ({ session: { id: "server-907" } }) }));

    await upload(liveSessionSyncTransport());
    expect(vi.getTimerCount()).toBe(0);

    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
    expect(signals[0]?.aborted).toBe(false);
  });

  test("a created session is returned as before", async () => {
    const session = { id: "server-907" };
    stubFetch(async () => ({ ok: true, status: 201, json: async () => ({ session }) }));

    await expect(liveSessionSyncTransport().createSession(payload)).resolves.toEqual(session);
  });
});

describe("liveSessionSyncTransport failure status (#978)", () => {
  test.each(uploads)("%s refused throws with the status and the answer's text", async (_name, upload) => {
    stubFetch(async () => ({ ok: false, status: 404, text: async () => '{"error":"Session not found"}' }));

    const error = await upload(liveSessionSyncTransport()).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: '{"error":"Session not found"}', status: 404, permanent: true });
    expect(failureStatus(error)).toBe(404);
  });

  test.each([
    [400, true],
    [401, true],
    [403, true],
    [409, true],
    [413, true],
    [422, true],
    [408, false],
    [429, false],
    [500, false],
    [503, false],
  ])("a %i is permanent: %s", async (status, permanent) => {
    stubFetch(async () => ({ ok: false, status, text: async () => "" }));

    const error = await liveSessionSyncTransport().createSession(payload).catch((caught: unknown) => caught);

    expect(isPermanentFailure(error)).toBe(permanent);
    expect(isNetworkFailure(error)).toBe(!permanent);
    expect(failureStatus(error)).toBe(status);
  });

  test("a failure that was never answered has no status", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });

    const error = await liveSessionSyncTransport().createSession(payload).catch((caught: unknown) => caught);

    expect(isNetworkFailure(error)).toBe(true);
    expect(isPermanentFailure(error)).toBe(false);
    expect(failureStatus(error)).toBeNull();
  });
});
