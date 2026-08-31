import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/offlineSessionQueue/pwaBootstrap", () => ({
  registerServiceWorker: vi.fn(),
}));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

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
    // Stand in for the real deadline so the test controls when it fires; the
    // assertion is that the request carries one and that firing it drains the queue.
    const deadline = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);

    const started: boolean[] = [];
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      started.push(JSON.parse(String(init.body)).active as boolean);
      const signal = init.signal as AbortSignal;
      return new Promise((resolve, reject) => {
        // Real fetch rejects immediately for an already-aborted signal; this stub
        // reuses one controller for every request, so it must do the same.
        if (signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }));

    const { reportSessionActiveState } = await import("./web-push-client");

    const pending = reportSessionActiveState(true);
    reportSessionActiveState(false);
    await flush();

    expect(timeoutSpy).toHaveBeenCalledWith(expect.any(Number));
    expect(started).toEqual([true]);

    deadline.abort();
    await expect(pending).resolves.toBeUndefined();
    await flush();

    // The queued sit-end still goes out rather than waiting on a dead request.
    expect(started).toEqual([true, false]);
    timeoutSpy.mockRestore();
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
