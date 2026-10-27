/** @vitest-environment jsdom */
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Session, User } from "./api";
import { rememberStandardSit } from "./practiceDaySits";
import type { PracticeDaySit } from "./sessionCalendar";
import { useDualTrackFork } from "./useDualTrackFork";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  getSessions: vi.fn(),
  enableDualTrack: vi.fn(),
  syncTrackingUnlockFromSessions: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { getSessions: mocks.getSessions, enableDualTrack: mocks.enableDualTrack },
}));

vi.mock("@/lib/trackingControlPrefs", () => ({
  syncTrackingUnlockFromSessions: mocks.syncTrackingUnlockFromSessions,
}));

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The local day the fake clock starts on (see `beforeEach`). */
const OCT_26 = "2026-10-26";
const OCT_25 = "2026-10-25";

const USER: User = {
  id: "user-1",
  email: "sitter@example.com",
  username: "sitter",
  isPublic: false,
  currentDay: 56,
  aphorismsEnabled: false,
  ambientSoundEnabled: true,
};

/** A user on both tracks. */
const DUAL: User = { ...USER, dualTrackEnabled: true, secondTrackDay: 20 };

const NEITHER_DONE = { primary: false, second: false } as const;

type Track = "primary" | "second";

/** A server row, narrowed to what the badges read. */
function row(sessionDate: string, track?: Track, completed = true): Session {
  return { completed, sessionType: "standard", sessionDate, track, duration: 600 } as Session;
}

/** #769: today's two sits done as one — a primary row the server marks combined. */
function combinedRow(sessionDate: string, completed = true): Session {
  return { ...row(sessionDate, "primary", completed), combined: true, duration: 850 } as Session;
}

/** The completed standard sit `practiceDaySit` derives from a row. */
function sit(sessionDate: string, track: Track): PracticeDaySit {
  return { completed: true, sessionType: "standard", sessionDate, track };
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

/** Queues the next `getSessions` answer. */
function serverHas(...sessions: Session[]) {
  mocks.getSessions.mockResolvedValueOnce({ sessions });
}

/* -------------------------------------------------------------------------- */
/* Minimal renderHook (no @testing-library/react in this repo)                 */
/* -------------------------------------------------------------------------- */

const liveViews: Array<{ unmount: () => Promise<void> }> = [];

type RenderOptions = { user?: User | null; authChecked?: boolean };
type Fork = Awaited<ReturnType<typeof renderFork>>;

async function renderFork({ user = USER, authChecked = true }: RenderOptions = {}) {
  const sessionGeneration = { current: 0 };
  const loadedSitsRef: { current: PracticeDaySit[] | null } = { current: null };
  const userRef: { current: User | null } = { current: user };

  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root | null = null;
  let latest!: ReturnType<typeof useDualTrackFork> & { user: User | null };

  function Probe() {
    // The real `user` state lives in the auth hook; a local one stands in so
    // `setUser` merges can be observed.
    const [current, setUser] = useState<User | null>(user);
    userRef.current = current;
    latest = {
      ...useDualTrackFork({ sessionGeneration, loadedSitsRef, user: current, userRef, authChecked, setUser }),
      user: current,
    };
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
    root.render(createElement(Probe));
  });

  return { current: () => latest, sessionGeneration, loadedSitsRef };
}

/** Mounts the hook with its first refresh answered by `sessions`. */
async function renderLoaded(sessions: Session[] = [], options?: RenderOptions) {
  serverHas(...sessions);
  return renderFork(options);
}

/* -------------------------------------------------------------------------- */
/* Actions                                                                    */
/* -------------------------------------------------------------------------- */

/** Runs a refresh to completion against whatever `getSessions` is queued to do. */
async function refresh(fork: Fork) {
  await act(async () => {
    await fork.current().refreshTodayTracks();
  });
}

/** Runs a refresh whose `getSessions` call fails, as it does offline. */
async function refreshFailing(fork: Fork, error: unknown = new Error("offline")) {
  mocks.getSessions.mockRejectedValueOnce(error);
  await refresh(fork);
}

/** Starts a refresh and holds its `getSessions` reply until the test settles it. */
async function startRefresh(fork: Fork) {
  const reply = deferred<{ sessions: Session[] }>();
  mocks.getSessions.mockReturnValueOnce(reply.promise);
  let done!: Promise<void>;
  await act(async () => {
    done = fork.current().refreshTodayTracks();
  });
  return {
    answer: (...sessions: Session[]) =>
      act(async () => {
        reply.resolve({ sessions });
        await done;
      }),
    fail: (error: unknown = new Error("offline")) =>
      act(async () => {
        reply.reject(error);
        await done;
      }),
  };
}

/** The session ends: every sign-out bumps `sessionGeneration`. */
function endSession(fork: Fork) {
  fork.sessionGeneration.current += 1;
}

/** Account teardown, as `useAuthBootstrap` runs it. */
async function tearDownAccount(fork: Fork) {
  endSession(fork);
  fork.loadedSitsRef.current = null;
  await act(async () => {
    fork.current().resetForAccount();
  });
}

/** A sit finished offline: its save starts a refresh, then remembers it as pending (#961). */
async function finishSitOffline(fork: Fork, track: Track, combined = false) {
  const pending = await startRefresh(fork);
  fork.loadedSitsRef.current = rememberStandardSit(fork.loadedSitsRef.current, OCT_26, track, combined);
  await pending.fail(new TypeError("Failed to fetch"));
}

/* -------------------------------------------------------------------------- */

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0)); // local Oct 26, noon
});

afterEach(async () => {
  for (const view of liveViews.splice(0)) {
    await view.unmount();
  }
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */

describe("useDualTrackFork — today's badges (#240)", () => {
  test("loads per-track badges once a signed-in user is known", async () => {
    const sessions = [row(OCT_26, "primary"), row(OCT_25, "second")];
    const fork = await renderLoaded(sessions);

    expect(mocks.getSessions).toHaveBeenCalledTimes(1);
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });
    expect(mocks.syncTrackingUnlockFromSessions).toHaveBeenCalledWith(sessions);
    expect(fork.loadedSitsRef.current).toEqual([sit(OCT_26, "primary"), sit(OCT_25, "second")]);
  });

  test("waits for the auth check and for a user", async () => {
    await renderFork({ authChecked: false });
    await renderFork({ user: null });
    expect(mocks.getSessions).not.toHaveBeenCalled();
  });

  test("a queued sit the server does not have yet still counts (#797)", async () => {
    mocks.getSessions.mockResolvedValue({ sessions: [] });
    const fork = await renderFork();
    fork.loadedSitsRef.current = [sit(OCT_26, "second")];

    await refresh(fork);

    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: true });
    expect(fork.loadedSitsRef.current).toHaveLength(1);
  });

  test("a failed refresh after the day rolls over keeps no stale badge", async () => {
    const fork = await renderLoaded([row(OCT_26, "primary")]);
    expect(fork.current().tracksDoneToday.primary).toBe(true);

    // #961: the remembered sit is still there, but it credits yesterday.
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0)); // local Oct 27, noon
    await refreshFailing(fork);

    expect(fork.current().tracksDoneToday).toEqual(NEITHER_DONE);
  });

  test("a failed refresh keeps a sit already loaded for today (#961)", async () => {
    const fork = await renderLoaded([row(OCT_26, "primary")]);

    await refreshFailing(fork);

    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: true, second: false },
      tracksDoneTodayKnown: false,
    });
  });

  test("a refresh that outlives its session is dropped (#666)", async () => {
    const fork = await renderLoaded();

    const pending = await startRefresh(fork);
    endSession(fork);
    fork.loadedSitsRef.current = null;
    await pending.answer(row(OCT_26, "primary"));

    expect(fork.current().tracksDoneToday).toEqual(NEITHER_DONE);
    expect(fork.loadedSitsRef.current).toBeNull();
  });

  test("a failed refresh from an ended session leaves the next account's badges alone (#833)", async () => {
    const fork = await renderLoaded();

    // The previous account's refresh is still in flight when the account changes.
    const stale = await startRefresh(fork);
    await tearDownAccount(fork);

    // The next account's own refresh lands first and earns a badge.
    serverHas(row(OCT_26, "primary"));
    await refresh(fork);
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });

    await stale.fail();

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });
    expect(fork.loadedSitsRef.current).toEqual([sit(OCT_26, "primary")]);
  });

  test("a sit remembered while a refresh is in flight survives it (#833)", async () => {
    const fork = await renderLoaded();

    // A pending save starts the refresh, and only then is its sit remembered.
    const pending = await startRefresh(fork);
    fork.loadedSitsRef.current = rememberStandardSit(fork.loadedSitsRef.current, OCT_26, "second");

    // The server answers, but without that sit: its own sync failed.
    await pending.answer(row(OCT_25, "primary"));

    expect(fork.loadedSitsRef.current).toEqual([sit(OCT_25, "primary"), sit(OCT_26, "second")]);
    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: true });
  });

  test("resetForAccount clears the badges and the dismissed fork", async () => {
    const fork = await renderLoaded([row(OCT_26, "primary")]);
    await act(async () => {
      fork.current().setForkDismissed(true);
    });
    expect(fork.current()).toMatchObject({ forkDismissed: true, tracksDoneToday: { primary: true } });

    await act(async () => {
      fork.current().resetForAccount();
    });

    expect(fork.current()).toMatchObject({ forkDismissed: false, tracksDoneToday: NEITHER_DONE });
  });
});

describe("useDualTrackFork — whether today's flags are known (#895)", () => {
  test("unknown while the first refresh is in flight, known once it lands", async () => {
    const reply = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(reply.promise);
    const fork = await renderFork();

    // Both flags read false here, which is not the same as both sits being due.
    expect(fork.current()).toMatchObject({ tracksDoneToday: NEITHER_DONE, tracksDoneTodayKnown: false });

    await act(async () => {
      reply.resolve({ sessions: [] });
      await reply.promise;
    });

    expect(fork.current()).toMatchObject({ tracksDoneToday: NEITHER_DONE, tracksDoneTodayKnown: true });
  });

  test("a failed refresh leaves them unknown, not neither-done", async () => {
    const fork = await renderLoaded();
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    await refreshFailing(fork);

    expect(fork.current()).toMatchObject({ tracksDoneToday: NEITHER_DONE, tracksDoneTodayKnown: false });
  });

  test("a refresh that fails after an overlapping one answered leaves them unknown", async () => {
    const fork = await renderLoaded();

    const first = await startRefresh(fork);
    const second = await startRefresh(fork);
    await first.answer(row(OCT_26, "primary"));
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    // The failure falls back to the remembered sits (#961), which hold what the
    // first one answered, but that is no longer an answer.
    await second.fail();

    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: true, second: false },
      tracksDoneTodayKnown: false,
    });
  });

  test("a later refresh holds them unknown until it answers", async () => {
    const fork = await renderLoaded();
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    // A sit was just saved, so the flags held now are about to change.
    const pending = await startRefresh(fork);
    expect(fork.current()).toMatchObject({ tracksDoneToday: NEITHER_DONE, tracksDoneTodayKnown: false });

    await pending.answer(row(OCT_26, "primary"));

    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: true, second: false },
      tracksDoneTodayKnown: true,
    });
  });

  test("a refresh that outlives its session does not make them known (#666)", async () => {
    const fork = await renderLoaded();

    const pending = await startRefresh(fork);
    endSession(fork);
    await pending.answer();

    expect(fork.current().tracksDoneTodayKnown).toBe(false);
  });

  test("resetForAccount makes them unknown", async () => {
    const fork = await renderLoaded();
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    await act(async () => {
      fork.current().resetForAccount();
    });

    expect(fork.current().tracksDoneTodayKnown).toBe(false);
  });
});

describe("useDualTrackFork — a combined sit (#892)", () => {
  test("one combined row checks off both tracks for the day", async () => {
    const fork = await renderLoaded([combinedRow(OCT_26)], { user: DUAL });

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });
  });

  test("a queued combined sit checks off both tracks while it waits to sync", async () => {
    mocks.getSessions.mockResolvedValue({ sessions: [] });
    const fork = await renderFork({ user: DUAL });
    fork.loadedSitsRef.current = rememberStandardSit(null, OCT_26, "primary", true);

    await refresh(fork);

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });
  });

  test("once it has synced, the remembered sit and the server's combined row are one sit", async () => {
    const fork = await renderLoaded([], { user: DUAL });
    fork.loadedSitsRef.current = rememberStandardSit(fork.loadedSitsRef.current, OCT_26, "primary", true);

    serverHas(combinedRow(OCT_26));
    await refresh(fork);

    expect(fork.loadedSitsRef.current).toEqual([{ ...sit(OCT_26, "primary"), combined: true }]);
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });
  });

  test("before 6:00, yesterday's combined sit has closed it, so the badges are the new day's", async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 5, 30, 0)); // local Oct 27, 5:30
    const fork = await renderLoaded([combinedRow(OCT_26)], { user: DUAL });

    // Both of Oct 26's tracks are done, so 5:30 already belongs to Oct 27.
    expect(fork.current().tracksDoneToday).toEqual(NEITHER_DONE);
  });

  test("control: before 6:00, a plain primary sit leaves a two-a-day yesterday open", async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 5, 30, 0)); // local Oct 27, 5:30
    const fork = await renderLoaded([row(OCT_26, "primary")], { user: DUAL });

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });
  });

  test("an ended-early combined sit checks off nothing", async () => {
    const fork = await renderLoaded([combinedRow(OCT_26, false)], { user: DUAL });

    expect(fork.current().tracksDoneToday).toEqual(NEITHER_DONE);
  });
});

describe("useDualTrackFork — a failed refresh falls back to the remembered sits (#961)", () => {
  test("a sit finished offline shows as done, and stays done while refreshes keep failing", async () => {
    const fork = await renderLoaded();

    await finishSitOffline(fork, "primary");
    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: true, second: false },
      tracksDoneTodayKnown: false,
    });

    await refreshFailing(fork, new TypeError("Failed to fetch"));
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });
  });

  test("a second-track sit finished offline checks off only Track Two", async () => {
    const fork = await renderLoaded([], { user: DUAL });

    await finishSitOffline(fork, "second");

    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: true });
  });

  test("a combined sit finished offline checks off both tracks", async () => {
    const fork = await renderLoaded([], { user: DUAL });

    await finishSitOffline(fork, "primary", true);

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });
  });

  test("an offline cold start, with nothing remembered, shows neither track done", async () => {
    mocks.getSessions.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const fork = await renderFork({ user: DUAL });

    expect(fork.loadedSitsRef.current).toBeNull();
    expect(fork.current()).toMatchObject({ tracksDoneToday: NEITHER_DONE, tracksDoneTodayKnown: false });
  });

  test("a failed refresh after a sign-out and a new sign-in shows nothing of the previous account", async () => {
    const fork = await renderLoaded([], { user: DUAL });
    await finishSitOffline(fork, "primary", true);
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });

    // The previous account's next refresh is still in flight when it signs out.
    const stale = await startRefresh(fork);
    await tearDownAccount(fork);

    // The next account's own refresh fails too: it has remembered nothing.
    await refreshFailing(fork, new TypeError("Failed to fetch"));
    expect(fork.current().tracksDoneToday).toEqual(NEITHER_DONE);

    // The previous account's failure lands last and changes nothing.
    await stale.fail(new TypeError("Failed to fetch"));
    expect(fork.current().tracksDoneToday).toEqual(NEITHER_DONE);
    expect(fork.loadedSitsRef.current).toBeNull();
  });
});

describe("useDualTrackFork — enabling the second track (#240, #664)", () => {
  async function enableDualTrack(fork: Fork) {
    await act(async () => {
      await fork.current().handleEnableDualTrack();
    });
  }

  test("merges the response into the user instead of replacing it", async () => {
    mocks.getSessions.mockResolvedValue({ sessions: [] });
    // The route's projection omits `ambientSoundEnabled`.
    mocks.enableDualTrack.mockResolvedValueOnce({
      user: { id: "user-1", currentDay: 56, dualTrackEnabled: true, secondTrackDay: 1 },
    });
    const fork = await renderFork();

    await enableDualTrack(fork);

    expect(fork.current().user).toMatchObject({
      dualTrackEnabled: true,
      secondTrackDay: 1,
      ambientSoundEnabled: true,
      username: "sitter",
    });
    // The badges are re-read for the newly enabled track.
    expect(mocks.getSessions).toHaveBeenCalledTimes(2);
  });

  test("never installs the partial response over a signed-out user", async () => {
    mocks.enableDualTrack.mockResolvedValueOnce({ user: { id: "user-1", dualTrackEnabled: true } });
    const fork = await renderFork({ user: null });

    await enableDualTrack(fork);

    expect(fork.current().user).toBeNull();
  });

  test("drops the response if a sign-out landed while it was in flight", async () => {
    mocks.getSessions.mockResolvedValue({ sessions: [] });
    const reply = deferred<{ user: Partial<User> }>();
    mocks.enableDualTrack.mockReturnValueOnce(reply.promise);
    const fork = await renderFork();

    let done!: Promise<void>;
    await act(async () => {
      done = fork.current().handleEnableDualTrack();
    });
    endSession(fork);
    await act(async () => {
      reply.resolve({ user: { id: "user-1", dualTrackEnabled: true } });
      await done;
    });

    expect(fork.current().user?.dualTrackEnabled).toBeUndefined();
    expect(mocks.getSessions).toHaveBeenCalledTimes(1);
  });
});
