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

const USER: User = {
  id: "user-1",
  email: "sitter@example.com",
  username: "sitter",
  isPublic: false,
  currentDay: 56,
  aphorismsEnabled: false,
  ambientSoundEnabled: true,
};

/** A server row, narrowed to what the badges read. */
function row(sessionDate: string, track?: "primary" | "second", completed = true): Session {
  return { completed, sessionType: "standard", sessionDate, track, duration: 600 } as Session;
}

/** #769: today's two sits done as one — a primary row the server marks combined. */
function combinedRow(sessionDate: string, completed = true): Session {
  return { ...row(sessionDate, "primary", completed), combined: true, duration: 850 } as Session;
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

/* -------------------------------------------------------------------------- */
/* Minimal renderHook (no @testing-library/react in this repo)                 */
/* -------------------------------------------------------------------------- */

const liveViews: Array<{ unmount: () => Promise<void> }> = [];

async function renderFork({ user = USER, authChecked = true }: { user?: User | null; authChecked?: boolean } = {}) {
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 26, 12, 0, 0)); // local Oct 26, noon
});

afterEach(async () => {
  for (const view of liveViews.splice(0)) {
    await view.unmount();
  }
  mocks.getSessions.mockReset();
  mocks.enableDualTrack.mockReset();
  mocks.syncTrackingUnlockFromSessions.mockReset();
  vi.useRealTimers();
});

/* -------------------------------------------------------------------------- */

describe("useDualTrackFork — today's badges (#240)", () => {
  test("loads per-track badges once a signed-in user is known", async () => {
    const sessions = [row("2026-10-26", "primary"), row("2026-10-25", "second")];
    mocks.getSessions.mockResolvedValueOnce({ sessions });
    const fork = await renderFork();

    expect(mocks.getSessions).toHaveBeenCalledTimes(1);
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });
    expect(mocks.syncTrackingUnlockFromSessions).toHaveBeenCalledWith(sessions);
    expect(fork.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: "2026-10-26", track: "primary" },
      { completed: true, sessionType: "standard", sessionDate: "2026-10-25", track: "second" },
    ]);
  });

  test("waits for the auth check and for a user", async () => {
    await renderFork({ authChecked: false });
    await renderFork({ user: null });
    expect(mocks.getSessions).not.toHaveBeenCalled();
  });

  test("a queued sit the server does not have yet still counts (#797)", async () => {
    mocks.getSessions.mockResolvedValue({ sessions: [] });
    const fork = await renderFork();
    fork.loadedSitsRef.current = [
      { completed: true, sessionType: "standard", sessionDate: "2026-10-26", track: "second" },
    ];

    await act(async () => {
      await fork.current().refreshTodayTracks();
    });

    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: true });
    expect(fork.loadedSitsRef.current).toHaveLength(1);
  });

  test("a failed refresh fails closed instead of keeping a stale badge", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [row("2026-10-26", "primary")] });
    const fork = await renderFork();
    expect(fork.current().tracksDoneToday.primary).toBe(true);

    mocks.getSessions.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await fork.current().refreshTodayTracks();
    });

    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: false });
  });

  test("a refresh that outlives its session is dropped (#666)", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();

    const reply = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(reply.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = fork.current().refreshTodayTracks();
    });
    fork.sessionGeneration.current += 1;
    fork.loadedSitsRef.current = null;
    await act(async () => {
      reply.resolve({ sessions: [row("2026-10-26", "primary")] });
      await done;
    });

    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: false });
    expect(fork.loadedSitsRef.current).toBeNull();
  });

  test("a failed refresh from an ended session leaves the next account's badges alone (#833)", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();

    // The previous account's refresh is still in flight when the account changes.
    const stale = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(stale.promise);
    let staleDone!: Promise<void>;
    await act(async () => {
      staleDone = fork.current().refreshTodayTracks();
    });
    fork.sessionGeneration.current += 1;
    fork.loadedSitsRef.current = null;
    await act(async () => {
      fork.current().resetForAccount();
    });

    // The next account's own refresh lands first and earns a badge.
    mocks.getSessions.mockResolvedValueOnce({ sessions: [row("2026-10-26", "primary")] });
    await act(async () => {
      await fork.current().refreshTodayTracks();
    });
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });

    await act(async () => {
      stale.reject(new Error("offline"));
      await staleDone;
    });

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });
    expect(fork.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: "2026-10-26", track: "primary" },
    ]);
  });

  test("a sit remembered while a refresh is in flight survives it (#833)", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();

    // A pending save starts the refresh, and only then is its sit remembered.
    const reply = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(reply.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = fork.current().refreshTodayTracks();
    });
    fork.loadedSitsRef.current = rememberStandardSit(fork.loadedSitsRef.current, "2026-10-26", "second");

    // The server answers, but without that sit: its own sync failed.
    await act(async () => {
      reply.resolve({ sessions: [row("2026-10-25", "primary")] });
      await done;
    });

    expect(fork.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: "2026-10-25", track: "primary" },
      { completed: true, sessionType: "standard", sessionDate: "2026-10-26", track: "second" },
    ]);
    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: true });
  });

  test("resetForAccount clears the badges and the dismissed fork", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [row("2026-10-26", "primary")] });
    const fork = await renderFork();
    await act(async () => {
      fork.current().setForkDismissed(true);
    });
    expect(fork.current()).toMatchObject({ forkDismissed: true, tracksDoneToday: { primary: true } });

    await act(async () => {
      fork.current().resetForAccount();
    });

    expect(fork.current()).toMatchObject({
      forkDismissed: false,
      tracksDoneToday: { primary: false, second: false },
    });
  });
});

describe("useDualTrackFork — whether today's flags are known (#895)", () => {
  test("unknown while the first refresh is in flight, known once it lands", async () => {
    const reply = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(reply.promise);
    const fork = await renderFork();

    // Both flags read false here, which is not the same as both sits being due.
    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: false, second: false },
      tracksDoneTodayKnown: false,
    });

    await act(async () => {
      reply.resolve({ sessions: [] });
      await reply.promise;
    });

    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: false, second: false },
      tracksDoneTodayKnown: true,
    });
  });

  test("a failed refresh leaves them unknown, not neither-done", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    mocks.getSessions.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await fork.current().refreshTodayTracks();
    });

    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: false, second: false },
      tracksDoneTodayKnown: false,
    });
  });

  test("a refresh that fails after an overlapping one answered leaves them unknown", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();

    const first = deferred<{ sessions: Session[] }>();
    const second = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let firstDone!: Promise<void>;
    let secondDone!: Promise<void>;
    await act(async () => {
      firstDone = fork.current().refreshTodayTracks();
      secondDone = fork.current().refreshTodayTracks();
    });
    await act(async () => {
      first.resolve({ sessions: [row("2026-10-26", "primary")] });
      await firstDone;
    });
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    // The failure resets the badges, so what the first one answered is gone too.
    await act(async () => {
      second.reject(new Error("offline"));
      await secondDone;
    });

    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: false, second: false },
      tracksDoneTodayKnown: false,
    });
  });

  test("a later refresh holds them unknown until it answers", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    // A sit was just saved, so the flags held now are about to change.
    const reply = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(reply.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = fork.current().refreshTodayTracks();
    });
    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: false, second: false },
      tracksDoneTodayKnown: false,
    });

    await act(async () => {
      reply.resolve({ sessions: [row("2026-10-26", "primary")] });
      await done;
    });

    expect(fork.current()).toMatchObject({
      tracksDoneToday: { primary: true, second: false },
      tracksDoneTodayKnown: true,
    });
  });

  test("a refresh that outlives its session does not make them known (#666)", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();

    const reply = deferred<{ sessions: Session[] }>();
    mocks.getSessions.mockReturnValueOnce(reply.promise);
    let done!: Promise<void>;
    await act(async () => {
      done = fork.current().refreshTodayTracks();
    });
    fork.sessionGeneration.current += 1;
    await act(async () => {
      reply.resolve({ sessions: [] });
      await done;
    });

    expect(fork.current().tracksDoneTodayKnown).toBe(false);
  });

  test("resetForAccount makes them unknown", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork();
    expect(fork.current().tracksDoneTodayKnown).toBe(true);

    await act(async () => {
      fork.current().resetForAccount();
    });

    expect(fork.current().tracksDoneTodayKnown).toBe(false);
  });
});

describe("useDualTrackFork — a combined sit (#892)", () => {
  const DUAL: User = { ...USER, dualTrackEnabled: true, secondTrackDay: 20 };

  test("one combined row checks off both tracks for the day", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [combinedRow("2026-10-26")] });
    const fork = await renderFork({ user: DUAL });

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });
  });

  test("a queued combined sit checks off both tracks while it waits to sync", async () => {
    mocks.getSessions.mockResolvedValue({ sessions: [] });
    const fork = await renderFork({ user: DUAL });
    fork.loadedSitsRef.current = rememberStandardSit(null, "2026-10-26", "primary", true);

    await act(async () => {
      await fork.current().refreshTodayTracks();
    });

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });
  });

  test("once it has synced, the remembered sit and the server's combined row are one sit", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [] });
    const fork = await renderFork({ user: DUAL });
    fork.loadedSitsRef.current = rememberStandardSit(fork.loadedSitsRef.current, "2026-10-26", "primary", true);

    mocks.getSessions.mockResolvedValueOnce({ sessions: [combinedRow("2026-10-26")] });
    await act(async () => {
      await fork.current().refreshTodayTracks();
    });

    expect(fork.loadedSitsRef.current).toEqual([
      { completed: true, sessionType: "standard", sessionDate: "2026-10-26", track: "primary", combined: true },
    ]);
    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: true });
  });

  test("before 6:00, yesterday's combined sit has closed it, so the badges are the new day's", async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 5, 30, 0)); // local Oct 27, 5:30
    mocks.getSessions.mockResolvedValueOnce({ sessions: [combinedRow("2026-10-26")] });
    const fork = await renderFork({ user: DUAL });

    // Both of Oct 26's tracks are done, so 5:30 already belongs to Oct 27.
    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: false });
  });

  test("control: before 6:00, a plain primary sit leaves a two-a-day yesterday open", async () => {
    vi.setSystemTime(new Date(2026, 9, 27, 5, 30, 0));
    mocks.getSessions.mockResolvedValueOnce({ sessions: [row("2026-10-26", "primary")] });
    const fork = await renderFork({ user: DUAL });

    expect(fork.current().tracksDoneToday).toEqual({ primary: true, second: false });
  });

  test("an ended-early combined sit checks off nothing", async () => {
    mocks.getSessions.mockResolvedValueOnce({ sessions: [combinedRow("2026-10-26", false)] });
    const fork = await renderFork({ user: DUAL });

    expect(fork.current().tracksDoneToday).toEqual({ primary: false, second: false });
  });
});

describe("useDualTrackFork — enabling the second track (#240, #664)", () => {
  test("merges the response into the user instead of replacing it", async () => {
    mocks.getSessions.mockResolvedValue({ sessions: [] });
    // The route's projection omits `ambientSoundEnabled`.
    mocks.enableDualTrack.mockResolvedValueOnce({
      user: { id: "user-1", currentDay: 56, dualTrackEnabled: true, secondTrackDay: 1 },
    });
    const fork = await renderFork();

    await act(async () => {
      await fork.current().handleEnableDualTrack();
    });

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

    await act(async () => {
      await fork.current().handleEnableDualTrack();
    });

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
    fork.sessionGeneration.current += 1;
    await act(async () => {
      reply.resolve({ user: { id: "user-1", dualTrackEnabled: true } });
      await done;
    });

    expect(fork.current().user?.dualTrackEnabled).toBeUndefined();
    expect(mocks.getSessions).toHaveBeenCalledTimes(1);
  });
});
