import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { api, type User } from "@/lib/api";
import { mergeRememberedSits, practiceDaySit, tracksDoneOn, type TracksDone } from "@/lib/practiceDaySits";
import { creditedLocalIsoDate, type PracticeDaySit } from "@/lib/sessionCalendar";
import { syncTrackingUnlockFromSessions } from "@/lib/trackingControlPrefs";

type UseDualTrackForkOptions = {
  /** #666: the page's session generation. A refresh from an ended session is
   *  dropped whether it succeeded or failed (#833). */
  sessionGeneration: RefObject<number>;
  /** Sits used to decide whether yesterday is still open. Refreshed here. */
  loadedSitsRef: RefObject<PracticeDaySit[] | null>;
  user: User | null;
  userRef: RefObject<User | null>;
  authChecked: boolean;
  setUser: Dispatch<SetStateAction<User | null>>;
};

/**
 * #240 — the dual-track fork: today's per-track completion badges, whether the
 * fork prompt was dismissed this session, and opting in to the second track.
 */
export function useDualTrackFork({
  sessionGeneration,
  loadedSitsRef,
  user,
  userRef,
  authChecked,
  setUser,
}: UseDualTrackForkOptions) {
  const [tracksDoneToday, setTracksDoneToday] = useState<TracksDone>({
    primary: false,
    second: false,
  });
  // #895: whether `tracksDoneToday` can be read as an answer. Before a refresh
  // lands and while one is in flight, both flags read false; after one fails
  // they hold only the sits this session remembers (#961). Either is right for
  // the badges but could read as "a sit is due" to anything offered only then.
  const [tracksDoneTodayKnown, setTracksDoneTodayKnown] = useState(false);
  const [forkDismissed, setForkDismissed] = useState(false);

  // #240: derive per-track "completed a standard sit today" from the session list,
  // to drive HomeView's completion badges. A missing `track` (pre-#240 row) counts
  // as the primary track.
  const refreshTodayTracks = useCallback(async () => {
    const generation = sessionGeneration.current;
    // #895: a refresh runs because the flags may be about to change (a sit was
    // saved, the second track switched on), so until it answers they are not known.
    setTracksDoneTodayKnown(false);
    try {
      const { sessions } = await api.getSessions();
      if (generation !== sessionGeneration.current) return;
      // #833: merged into the sits as they are now, not a copy taken before the
      // request. For a pending save, `saveCompletedSit` starts this refresh before
      // `handleSessionComplete` remembers the sit, so that copy would not have it.
      const sits = mergeRememberedSits(sessions.map(practiceDaySit), loadedSitsRef.current ?? []);
      loadedSitsRef.current = sits;
      const today = creditedLocalIsoDate(sits, !!userRef.current?.dualTrackEnabled);
      const done = tracksDoneOn(sits, today);
      syncTrackingUnlockFromSessions(sessions);
      setTracksDoneToday(done);
      setTracksDoneTodayKnown(true);
    } catch {
      // #833: a failure from an ended session is dropped, as its response
      // would be. Failing closed here would clear the badges of whoever has
      // signed in since.
      if (generation !== sessionGeneration.current) return;
      // #961: the badges fall back to the sits this session remembers rather
      // than clearing outright. A sit finished offline is saved as pending and
      // remembered (`rememberStoredSit`), but the refresh its save starts fails
      // for the same reason, so clearing here left Home showing neither track
      // done right after a sit. What fail-closed protected still holds:
      // - Only this session's sits. The generation check above drops a failure
      //   that outlived its session, and every account teardown nulls
      //   `loadedSitsRef`, so a previous account's sits are never read here.
      // - Only the credited day. `tracksDoneOn` reads the day the sits credit
      //   now, so a sit from a day that has rolled over checks off nothing.
      // - Nothing remembered (an offline cold start) still reads neither done.
      // The flags stay unknown (#895): a sit synced from another device could be
      // missing, so "not done" here is not an answer anything should act on.
      const remembered = loadedSitsRef.current ?? [];
      const today = creditedLocalIsoDate(remembered, !!userRef.current?.dualTrackEnabled);
      setTracksDoneToday(tracksDoneOn(remembered, today));
      setTracksDoneTodayKnown(false);
    }
  }, [sessionGeneration, loadedSitsRef, userRef]);

  const handleEnableDualTrack = useCallback(async () => {
    const generation = sessionGeneration.current;
    const { user: updated } = await api.enableDualTrack();
    if (generation !== sessionGeneration.current) return;
    // Merged rather than replaced. Every other `setUser` on this page merges
    // per-field; replacing wholesale silently nulls any column this route's
    // projection happens to omit (today, `ambientSoundEnabled`). That is the
    // same failure #664 hit on iOS, where the whole-response adoption is
    // structural — here it is one call site, so merge and it cannot happen.
    //
    // A null `prev` stays null rather than being installed. The generation guard
    // above already drops a response that outlived its session — every sign-out
    // bumps `sessionGeneration`, the auth check's authoritative one included
    // (#833) — so this is the backstop: a partial response must never become a
    // whole identity, missing whatever the projection omits.
    setUser((prev) => (prev ? { ...prev, ...updated } : prev));
    void refreshTodayTracks();
  }, [sessionGeneration, setUser, refreshTodayTracks]);

  // #240: load per-track completion badges once a user is present.
  useEffect(() => {
    if (!user || !authChecked) return;
    void refreshTodayTracks();
  }, [user?.id, authChecked, refreshTodayTracks]);

  /** Account teardown: the badges and the dismissed fork belonged to the previous account. */
  const resetForAccount = useCallback(() => {
    setTracksDoneToday({ primary: false, second: false });
    setTracksDoneTodayKnown(false);
    setForkDismissed(false);
  }, []);

  return {
    tracksDoneToday,
    tracksDoneTodayKnown,
    forkDismissed,
    setForkDismissed,
    refreshTodayTracks,
    handleEnableDualTrack,
    resetForAccount,
  };
}
