import { useCallback, useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { api, type User } from "@/lib/api";
import { mergeRememberedSits, practiceDaySit, tracksDoneOn, type TracksDone } from "@/lib/practiceDaySits";
import { creditedLocalIsoDate, type PracticeDaySit } from "@/lib/sessionCalendar";
import { syncTrackingUnlockFromSessions } from "@/lib/trackingControlPrefs";

type UseDualTrackForkOptions = {
  /** #666: the page's session generation. A successful refresh from an ended
   *  session is dropped; a failed one still clears the badges (#833). */
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
  const [forkDismissed, setForkDismissed] = useState(false);

  // #240: derive per-track "completed a standard sit today" from the session list,
  // to drive HomeView's completion badges. A missing `track` (pre-#240 row) counts
  // as the primary track.
  const refreshTodayTracks = useCallback(async () => {
    const generation = sessionGeneration.current;
    const remembered = loadedSitsRef.current ?? [];
    try {
      const { sessions } = await api.getSessions();
      if (generation !== sessionGeneration.current) return;
      const sits = mergeRememberedSits(sessions.map(practiceDaySit), remembered);
      loadedSitsRef.current = sits;
      const today = creditedLocalIsoDate(sits, !!userRef.current?.dualTrackEnabled);
      const done = tracksDoneOn(sits, today);
      syncTrackingUnlockFromSessions(sessions);
      setTracksDoneToday(done);
    } catch {
      // Fail closed so a failed refresh can't leave a stale "done today"
      // badge on screen (e.g. after switching accounts).
      setTracksDoneToday({ primary: false, second: false });
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
    // above catches an explicit logout, which bumps `sessionGeneration` — but the
    // auth check's `signedOut` outcome clears `user` without bumping it, and
    // installing this partial response there would resurrect an identity the app
    // has already signed out, missing whatever the projection omits.
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
    setForkDismissed(false);
  }, []);

  return {
    tracksDoneToday,
    forkDismissed,
    setForkDismissed,
    refreshTodayTracks,
    handleEnableDualTrack,
    resetForAccount,
  };
}
