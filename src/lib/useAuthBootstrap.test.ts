/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { User } from "./api";
import { loadCachedUser, saveCachedUser } from "./cachedUser";
import type { PracticeDaySit } from "./sessionCalendar";
import { useAuthBootstrap } from "./useAuthBootstrap";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  getSessions: vi.fn(),
  clearQueue: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { me: mocks.me, getSessions: mocks.getSessions },
}));

vi.mock("@/lib/offlineSessionQueue", () => ({
  getWebSessionSyncCoordinator: () => ({ clearQueue: mocks.clearQueue }),
}));

const USER_A: User = {
  id: "user-a",
  email: "a@example.com",
  username: "alpha",
  isPublic: false,
  currentDay: 5,
  aphorismsEnabled: false,
};

const USER_B: User = { ...USER_A, id: "user-b", email: "b@example.com", username: "beta" };

/**
 * jsdom 29 under Vitest 4 exposes a `window` with no `localStorage`, so the
 * suite supplies its own conforming Storage (same shim as `cachedUser.test.ts`).
 */
function installMemoryStorage(): void {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key) => {
      entries.delete(key);
    },
    setItem: (key, value) => {
      entries.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: storage,
  });
}

/** Just enough of a `Response` for the bootstrap: `ok`, `status`, `json()`. */
function respond(status: number, body: unknown = {}): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const fetchMock = vi.fn<(input: string) => Promise<Response>>();

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

/** Lets the bootstrap's chain of awaits (fetch, then `json()`) run to the end. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/* -------------------------------------------------------------------------- */
/* Minimal renderHook (no @testing-library/react in this repo)                 */
/* -------------------------------------------------------------------------- */

const liveViews: Array<{ unmount: () => Promise<void> }> = [];

async function renderAuth({ isOnline = true }: { isOnline?: boolean } = {}) {
  const sessionGeneration = { current: 0 };
  const loadedSitsRef: { current: PracticeDaySit[] | null } = { current: null };
  const onAccountTeardown = vi.fn();

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let latest!: ReturnType<typeof useAuthBootstrap>;

  function Probe({ online }: { online: boolean }) {
    latest = useAuthBootstrap({ sessionGeneration, loadedSitsRef, isOnline: online, onAccountTeardown });
    return null;
  }

  const view = {
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      root = null;
      container.remove();
    },
  };
  liveViews.push(view);
  await act(async () => {
    root = createRoot(container);
    root.render(createElement(Probe, { online: isOnline }));
  });

  return {
    current: () => latest,
    sessionGeneration,
    loadedSitsRef,
    onAccountTeardown,
    setOnline: async (online: boolean) => {
      await act(async () => {
        root?.render(createElement(Probe, { online }));
      });
    },
  };
}

beforeEach(() => {
  installMemoryStorage();
  setVisibility("visible");
  vi.stubGlobal("fetch", fetchMock);
  // Midday, so the bootstrap skips the before-6:00 session read unless a test
  // moves the clock. Only `Date` is faked; React keeps its real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0));
  mocks.clearQueue.mockResolvedValue(undefined);
});

afterEach(async () => {
  for (const view of liveViews.splice(0)) {
    await view.unmount();
  }
  fetchMock.mockReset();
  mocks.me.mockReset();
  mocks.getSessions.mockReset();
  mocks.clearQueue.mockReset();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */

describe("useAuthBootstrap — bootstrap outcomes (#666)", () => {
  test("a confirmed user is adopted and cached for the next offline launch", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_A }));
    const auth = await renderAuth();
    await settle();

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/auth/me?date=2026-10-26");
    expect(auth.current()).toMatchObject({
      user: USER_A,
      authChecked: true,
      authError: null,
      runningFromCache: false,
    });
    expect(auth.current().userRef.current).toEqual(USER_A);
    expect(loadCachedUser()).toEqual(USER_A);
  });

  test("an unreachable server keeps the user signed in from the cached identity", async () => {
    saveCachedUser(USER_A);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const auth = await renderAuth();
    await settle();

    expect(auth.current()).toMatchObject({ user: USER_A, authChecked: true, runningFromCache: true });
    expect(auth.onAccountTeardown).not.toHaveBeenCalled();
    expect(loadCachedUser()).toEqual(USER_A);
  });

  test("a server error with nothing cached shows the retryable error and clears nothing", async () => {
    fetchMock.mockResolvedValueOnce(respond(500));
    const auth = await renderAuth();
    await settle();

    expect(auth.current()).toMatchObject({
      user: null,
      authChecked: true,
      authError: "Unable to verify your sign-in due to a server issue. Please retry.",
    });
    expect(auth.onAccountTeardown).not.toHaveBeenCalled();
  });

  test("an authoritative 401 signs out and tears down account state", async () => {
    saveCachedUser(USER_A);
    fetchMock.mockResolvedValueOnce(respond(401));
    const auth = await renderAuth();
    await settle();

    expect(auth.current()).toMatchObject({
      user: null,
      authChecked: true,
      authError: null,
      runningFromCache: false,
    });
    expect(auth.onAccountTeardown).toHaveBeenCalledTimes(1);
    expect(loadCachedUser()).toBeNull();
  });

  test("a 2xx with no user is the server reporting no account", async () => {
    saveCachedUser(USER_A);
    fetchMock.mockResolvedValueOnce(respond(200, { user: null }));
    const auth = await renderAuth();
    await settle();

    expect(auth.current().user).toBeNull();
    expect(auth.onAccountTeardown).toHaveBeenCalledTimes(1);
    expect(loadCachedUser()).toBeNull();
  });

  test("retryAuth returns to the loading state and bootstraps again", async () => {
    fetchMock.mockResolvedValueOnce(respond(500));
    const auth = await renderAuth();
    await settle();
    expect(auth.current().authError).not.toBeNull();

    const pending = deferred<Response>();
    fetchMock.mockReturnValueOnce(pending.promise);
    await act(async () => {
      auth.current().retryAuth();
    });
    expect(auth.current()).toMatchObject({ authChecked: false, authError: null });

    pending.resolve(respond(200, { user: USER_A }));
    await settle();
    expect(auth.current()).toMatchObject({ user: USER_A, authChecked: true, authError: null });
  });
});

describe("useAuthBootstrap — re-checks while running from cache (#666)", () => {
  test("coming back online re-runs the bootstrap and clears the offline run", async () => {
    saveCachedUser(USER_A);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const auth = await renderAuth({ isOnline: false });
    await settle();
    expect(auth.current().runningFromCache).toBe(true);

    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_A }));
    await auth.setOnline(true);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.current().runningFromCache).toBe(false);
  });

  test("a normal online session does not re-auth when the link flaps", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_A }));
    const auth = await renderAuth();
    await settle();

    await auth.setOnline(false);
    await auth.setOnline(true);
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returning to the tab re-checks, which covers failures that leave onLine true", async () => {
    saveCachedUser(USER_A);
    // A 5xx with the link up. Entering the offline run while online fires the
    // reconnect re-check once; it fails the same way.
    fetchMock.mockResolvedValueOnce(respond(503)).mockResolvedValueOnce(respond(503));
    const auth = await renderAuth();
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(auth.current().runningFromCache).toBe(true);

    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_A }));
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(auth.current().runningFromCache).toBe(false);
  });

  test("a hidden tab does not re-check on focus", async () => {
    saveCachedUser(USER_A);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const auth = await renderAuth({ isOnline: false });
    await settle();
    expect(auth.current().runningFromCache).toBe(true);

    setVisibility("hidden");
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useAuthBootstrap — sign-in and sign-out", () => {
  test("sign-in adopts the user, then the server's fresh copy (#238)", async () => {
    fetchMock.mockResolvedValueOnce(respond(401));
    const auth = await renderAuth();
    await settle();

    const fresh = { ...USER_A, recoveryTargetDay: 5, recoveryCurrentStep: 1, recoveryTotalSteps: 4 };
    const refetch = deferred<Response>();
    fetchMock.mockReturnValueOnce(refetch.promise);
    await act(async () => {
      auth.current().signIn(USER_A);
    });
    expect(auth.current().user).toEqual(USER_A);
    expect(auth.sessionGeneration.current).toBe(1);

    refetch.resolve(respond(200, { user: fresh }));
    await settle();
    expect(auth.current().user).toEqual(fresh);
  });

  test("sign-out clears the identity, tears down account state, and empties the queue", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_A }));
    const auth = await renderAuth();
    await settle();
    auth.loadedSitsRef.current = [{ completed: true, sessionType: "standard", sessionDate: "2026-10-26" }];

    await act(async () => {
      auth.current().signOut();
    });

    expect(auth.current()).toMatchObject({ user: null, runningFromCache: false });
    expect(auth.sessionGeneration.current).toBe(1);
    expect(auth.loadedSitsRef.current).toBeNull();
    expect(auth.onAccountTeardown).toHaveBeenCalledTimes(1);
    expect(loadCachedUser()).toBeNull();
    expect(mocks.clearQueue).toHaveBeenCalledTimes(1);
  });

  test("a stale 401 from a re-check that outlived a sign-out cannot sign out the next account", async () => {
    saveCachedUser(USER_A);
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const auth = await renderAuth({ isOnline: false });
    await settle();

    // Back online: the re-check is in flight when the user signs out and a
    // different account signs in.
    const recheck = deferred<Response>();
    fetchMock.mockReturnValueOnce(recheck.promise);
    await auth.setOnline(true);
    await act(async () => {
      auth.current().signOut();
    });
    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_B }));
    await act(async () => {
      auth.current().signIn(USER_B);
    });
    await settle();

    recheck.resolve(respond(401));
    await settle();

    expect(auth.current().user).toEqual(USER_B);
    expect(loadCachedUser()).toEqual(USER_B);
    // Once, for the explicit sign-out — never again for the stale answer.
    expect(auth.onAccountTeardown).toHaveBeenCalledTimes(1);
  });

  test("a sign-in re-fetch that lands after a sign-out is dropped", async () => {
    fetchMock.mockResolvedValueOnce(respond(401));
    const auth = await renderAuth();
    await settle();

    const refetch = deferred<Response>();
    fetchMock.mockReturnValueOnce(refetch.promise);
    await act(async () => {
      auth.current().signIn(USER_A);
    });
    await act(async () => {
      auth.current().signOut();
    });
    refetch.resolve(respond(200, { user: USER_A }));
    await settle();

    expect(auth.current().user).toBeNull();
    expect(loadCachedUser()).toBeNull();
  });

  test("refreshUserFromServer drops a reply from a session that has since ended", async () => {
    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_A }));
    const auth = await renderAuth();
    await settle();

    const reply = deferred<{ user: User }>();
    mocks.me.mockReturnValueOnce(reply.promise);
    await act(async () => {
      auth.current().refreshUserFromServer();
    });
    expect(mocks.me).toHaveBeenCalledWith("2026-10-26");
    await act(async () => {
      auth.current().signOut();
    });
    reply.resolve({ user: USER_A });
    await settle();

    expect(auth.current().user).toBeNull();
  });
});

describe("useAuthBootstrap — practice day before 6:00 (#797)", () => {
  test("asks for the day still open, then refines it once dual-track is known", async () => {
    vi.setSystemTime(new Date(2026, 9, 26, 5, 0, 0)); // local Oct 26, 5:00
    // Yesterday has its primary sit. Assuming dual-track, yesterday is still
    // open; a single-track user has already closed it.
    mocks.getSessions.mockResolvedValueOnce({
      sessions: [{ completed: true, sessionType: "standard", sessionDate: "2026-10-25", track: "primary" }],
    });
    const refined = { ...USER_A, currentDay: 6 };
    fetchMock
      .mockResolvedValueOnce(respond(200, { user: { ...USER_A, dualTrackEnabled: false } }))
      .mockResolvedValueOnce(respond(200, { user: refined }));
    const auth = await renderAuth();
    await settle();

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/me?date=2026-10-25",
      "/api/auth/me?date=2026-10-26",
    ]);
    expect(auth.current().user).toEqual(refined);
    expect(auth.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: "2026-10-25", track: "primary" },
    ]);
  });

  test("a failed session read keeps yesterday open", async () => {
    vi.setSystemTime(new Date(2026, 9, 26, 5, 0, 0));
    mocks.getSessions.mockRejectedValueOnce(new Error("offline"));
    fetchMock.mockResolvedValueOnce(respond(200, { user: USER_A }));
    const auth = await renderAuth();
    await settle();

    expect(fetchMock.mock.calls[0]![0]).toBe("/api/auth/me?date=2026-10-25");
    expect(auth.loadedSitsRef.current).toBeNull();
    expect(auth.current().user).toEqual(USER_A);
  });
});
