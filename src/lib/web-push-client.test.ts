import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/offlineSessionQueue/pwaBootstrap", () => ({
  registerServiceWorker: vi.fn(),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Records every `AbortController` the module builds, so a test can fire a
 * request's deadline itself rather than waiting out the real timeout.
 */
function captureAbortControllers(): AbortController[] {
  const created: AbortController[] = [];
  const Real = AbortController;
  vi.stubGlobal("AbortController", class extends Real {
    constructor() {
      super();
      created.push(this);
    }
  });
  return created;
}

type Recorder = {
  started: boolean[];
  settle: (index: number) => void;
};

/** Stubs fetch with manually-settled responses and records each request's `active`. */
function stubFetch(): Recorder {
  const started: boolean[] = [];
  const resolvers: Array<() => void> = [];

  vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
    started.push(JSON.parse(String(init.body)).active as boolean);
    return new Promise((resolve) => {
      resolvers.push(() => resolve({ ok: true } as Response));
    });
  }));

  return { started, settle: (index: number) => resolvers[index]() };
}

describe("reportSessionActiveState (#709)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  test("applies reports in call order even when requests overlap", async () => {
    const { started, settle } = stubFetch();
    const { reportSessionActiveState } = await import("./web-push-client");

    const first = reportSessionActiveState(true);
    reportSessionActiveState(false);
    await flush();

    // The second report must not start until the first settles, so the server
    // cannot see the sit-start after the sit-end.
    expect(started).toEqual([true]);

    settle(0);
    await flush();
    expect(started).toEqual([true, false]);

    settle(1);
    await first;
  });

  test("coalesces heartbeats queued behind a slow request, keeping the final state", async () => {
    const { started, settle } = stubFetch();
    const { reportSessionActiveState } = await import("./web-push-client");

    reportSessionActiveState(true);
    await flush();
    expect(started).toEqual([true]);

    // Three more reports pile up while the first request is still open. Only the
    // newest state matters — the endpoint stores absolute state, not a delta.
    reportSessionActiveState(true);
    reportSessionActiveState(true);
    reportSessionActiveState(false);

    settle(0);
    await flush();
    expect(started).toEqual([true, false]);

    settle(1);
    await flush();
    // Queue drained: nothing left over to re-suppress after the sit ended.
    expect(started).toEqual([true, false]);
  });

  test("drops a queued report at an auth boundary", async () => {
    const { started, settle } = stubFetch();
    const { reportSessionActiveState, resetSessionStateReports } = await import("./web-push-client");

    reportSessionActiveState(true);
    await flush();
    expect(started).toEqual([true]);

    // A sit is still being reported when the account signs out. The queued state
    // must not drain under the next account's cookie and silence them instead.
    reportSessionActiveState(true);
    resetSessionStateReports();

    settle(0);
    await flush();
    expect(started).toEqual([true]);

    // The next account starts a fresh chain rather than inheriting the old one.
    reportSessionActiveState(false);
    await flush();
    expect(started).toEqual([true, false]);
  });

  test("aborts the in-flight request at an auth boundary", async () => {
    const started: boolean[] = [];
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      started.push(JSON.parse(String(init.body)).active as boolean);
      const signal = init.signal as AbortSignal;
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        if (signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }));

    const { reportSessionActiveState, resetSessionStateReports } = await import("./web-push-client");

    reportSessionActiveState(true);
    await flush();
    expect(started).toEqual([true]);
    expect(signals[0].aborted).toBe(false);

    // Forgetting `inFlight` is not enough: the request is already on the wire and
    // carries a cookie that is still valid when the same account signs back in.
    // Left alone, that stale `true` can settle after the next sit's `false` and
    // mute the user for a full TTL — or a stale `false` can settle after a new
    // `true` and put banners in the middle of the next sit.
    resetSessionStateReports();
    expect(signals[0].aborted).toBe(true);

    // The abort must not trigger the clear-retry path under the new epoch.
    await flush();
    expect(started).toEqual([true]);
  });

  test("a superseded chain cannot clobber the queue after a reset", async () => {
    const { started, settle } = stubFetch();
    const { reportSessionActiveState, resetSessionStateReports } = await import("./web-push-client");

    reportSessionActiveState(true);
    await flush();
    resetSessionStateReports();

    // New account reports a sit while the previous account's request is still open.
    reportSessionActiveState(true);
    await flush();
    expect(started).toEqual([true, true]);

    // The stale request settling must not free the new chain's slot, or the next
    // report would run concurrently and could land out of order.
    settle(0);
    await flush();
    reportSessionActiveState(false);
    await flush();
    expect(started).toEqual([true, true]);

    settle(1);
    await flush();
    expect(started).toEqual([true, true, false]);
  });

  test("a request that never settles is unblocked by its deadline", async () => {
    // Each attempt now builds its own controller (so the same one can also be
    // tripped by an auth boundary), rather than taking a shared
    // `AbortSignal.timeout`. Capture them so the test fires each deadline itself
    // instead of waiting out the real 10s.
    const controllers = captureAbortControllers();

    const started: boolean[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      started.push(JSON.parse(String(init.body)).active as boolean);
      const signal = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }));

    const { reportSessionActiveState } = await import("./web-push-client");

    const pending = reportSessionActiveState(true);
    reportSessionActiveState(false);
    await flush();

    // The request carries a deadline it can be cancelled by.
    expect(controllers).toHaveLength(1);
    expect(started).toEqual([true]);

    // Firing it drains the queued sit-end rather than leaving it stuck behind a
    // dead request.
    controllers[0].abort();
    await flush();
    expect(started).toEqual([true, false]);

    // Each attempt gets its own deadline now, so the sit-end is still open here —
    // failing it exercises the clear-retry path, which gets a third deadline.
    controllers[1].abort();
    await flush();
    expect(started).toEqual([true, false, false]);

    // Once the retry's deadline fires too, the chain is finished and the original
    // caller is released — its promise settles when the report that superseded it
    // has been sent, not when its own request did.
    controllers[2].abort();
    await expect(pending).resolves.toBeUndefined();
  });

  test("retries a failed clear once, but never a heartbeat", async () => {
    // A 5xx resolves rather than rejects, so without the status check this would
    // look delivered. The clear is the only report nothing re-asserts: the
    // heartbeat repeats `true` every 60s, so dropping one is harmless, but a
    // dropped `false` leaves the user muted until the server-side TTL expires.
    const sent: boolean[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).active as boolean);
      return Promise.resolve({ ok: false, status: 500 } as Response);
    }));

    const { reportSessionActiveState } = await import("./web-push-client");

    await reportSessionActiveState(true);
    expect(sent).toEqual([true]);

    await reportSessionActiveState(false);
    expect(sent).toEqual([true, false, false]);
  });

  test("does not retry a clear rejected as unauthenticated", async () => {
    // 401 means the session is gone; retrying cannot fix it and the server's TTL
    // releases the hold on its own.
    const sent: boolean[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      sent.push(JSON.parse(String(init.body)).active as boolean);
      return Promise.resolve({ ok: false, status: 401 } as Response);
    }));

    const { reportSessionActiveState } = await import("./web-push-client");

    await reportSessionActiveState(false);
    expect(sent).toEqual([false]);
  });

  test("a failed report does not stall the next one", async () => {
    const sent: boolean[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      const active = JSON.parse(String(init.body)).active as boolean;
      sent.push(active);
      return active ? Promise.reject(new Error("offline")) : Promise.resolve({ ok: true } as Response);
    }));

    const { reportSessionActiveState } = await import("./web-push-client");

    await reportSessionActiveState(true);
    await expect(reportSessionActiveState(false)).resolves.toBeUndefined();
    expect(sent).toEqual([true, false]);
  });
});
