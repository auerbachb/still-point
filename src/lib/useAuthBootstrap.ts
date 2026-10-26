import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api, type User } from "@/lib/api";
import { clearCachedUser, clearCachedUserIfAuthoritative, loadCachedUser, saveCachedUser } from "@/lib/cachedUser";
import { authErrorMessageFor, resolveAuthBootstrap, type MeFailure } from "@/lib/offlineAuth";
import { getWebSessionSyncCoordinator } from "@/lib/offlineSessionQueue";
import { creditedPracticeDate, practiceDaySit } from "@/lib/practiceDaySits";
import { GRACE_CUTOFF_HOUR, type PracticeDaySit } from "@/lib/sessionCalendar";

type UseAuthBootstrapOptions = {
  /** #666: the page's monotonic session generation. An explicit sign-in or
   *  sign-out bumps it, and every adoption after an await checks it. An
   *  authoritative 401/403/404 clears `user` without bumping it (#833). */
  sessionGeneration: RefObject<number>;
  /** Sits used to decide whether yesterday is still open. Null until a fetch lands. */
  loadedSitsRef: RefObject<PracticeDaySit[] | null>;
  /** `useOnlineStatus()`: link state, which prompts a re-check and never concludes one. */
  isOnline: boolean;
  /** Clears account-scoped local state. Runs on both teardowns — an explicit
   *  sign-out and an authoritative 401/403/404 — never on a failure that only
   *  means the server could not be reached. */
  onAccountTeardown: () => void;
};

/**
 * #666 — who is signed in, and how the app keeps knowing it with no network:
 * the `/api/auth/me` bootstrap and its cached-identity fallback, the re-checks
 * that end an offline run, and sign-in / sign-out.
 */
export function useAuthBootstrap({
  sessionGeneration,
  loadedSitsRef,
  isOnline,
  onAccountTeardown,
}: UseAuthBootstrapOptions) {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRetryKey, setAuthRetryKey] = useState(0);
  // #666: running the app from the locally cached identity because the server
  // could not be reached. Only a *successful* `/api/auth/me` clears it, mirroring
  // the iOS `isOfflineMode` — `navigator.onLine` reports link state, not
  // reachability, so it prompts a re-check and never concludes one.
  const [runningFromCache, setRunningFromCache] = useState(false);
  const userRef = useRef(user);
  userRef.current = user;
  // Read through a ref so the bootstrap effect stays keyed on `authRetryKey`
  // alone: a new teardown closure from the page must never re-run it.
  const onAccountTeardownRef = useRef(onAccountTeardown);
  onAccountTeardownRef.current = onAccountTeardown;

  // #666: re-read the user from the server after an action that moves account
  // state (a completed sit advancing the day number, say). The result is dropped
  // if the session changed while the request was in flight — see
  // `sessionGeneration`. One helper rather than three copies of the guard, so a
  // future call site cannot adopt a user without it.
  const refreshUserFromServer = useCallback(() => {
    const generation = sessionGeneration.current;
    const now = new Date();
    const date = creditedPracticeDate(
      loadedSitsRef.current,
      !!userRef.current?.dualTrackEnabled,
      now,
    );
    void api
      .me(date)
      .then(({ user: u }) => {
        if (generation === sessionGeneration.current) setUser(u);
      })
      .catch(() => {});
  }, [sessionGeneration, loadedSitsRef]);

  // #666: the single place a server-confirmed user reaches the local copy that
  // survives a reload with no network — the web analogue of the iOS
  // `applyAuthenticatedUser`. An effect rather than a call at each `setUser`
  // site, so every adoption path (bootstrap, sign-in, settings PATCH, buddy
  // completion) keeps the cache tracking the account without a call site being
  // able to forget. Sign-out paths set `user` to null and clear the cache
  // explicitly; every *asynchronous* adoption is gated on `sessionGeneration`
  // above, so a response still in flight when the user signs out cannot reach
  // this effect and resurrect a signed-out identity.
  useEffect(() => {
    if (user) saveCachedUser(user);
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    // The reconnect path re-runs this effect on a live, signed-in screen, so a
    // sign-out can land between the request and its response (#666).
    const generation = sessionGeneration.current;

    /** Apply a failed `me()` through the shared offline-auth decision (#666). */
    function applyFailure(failure: MeFailure) {
      // Guarded here rather than at each call site so the *destructive* branch
      // cannot outlive its session: a 401/403/404 from a bootstrap that was
      // still in flight across a sign-out would otherwise sign out — and clear
      // the cached identity of — whichever account replaced it.
      if (cancelled || generation !== sessionGeneration.current) return;
      const cachedUser = loadCachedUser();
      const outcome = resolveAuthBootstrap(failure, cachedUser !== null);

      // Matching on the pair keeps the cached user's presence and the outcome
      // from drifting apart: without an identity to render there is nothing to
      // fall back to, whatever the outcome says.
      if (outcome.action === "offline" && cachedUser) {
        setUser(cachedUser);
        setRunningFromCache(true);
        setAuthError(null);
        setAuthChecked(true);
        return;
      }

      setRunningFromCache(false);

      if (outcome.action === "signedOut") {
        loadedSitsRef.current = null;
        setUser(null);
        // Teardown is gated on the one shared predicate — asked once, through
        // the cached-identity store, whose answer then gates the rest (the iOS
        // `clearIfAuthoritative` shape). Not on "the request failed", which is
        // the bug #665/#666 exist to remove.
        if (clearCachedUserIfAuthoritative(outcome.cause)) {
          onAccountTeardownRef.current();
        }
        setAuthError(null);
        setAuthChecked(true);
        return;
      }

      // `unavailable`: no trustworthy answer and nothing cached to render.
      // Deliberately keeps every piece of local state, cache included.
      setAuthError(authErrorMessageFor(outcome.cause));
      setAuthChecked(true);
    }

    async function checkAuth() {
      try {
        const now = new Date();
        if (now.getHours() < GRACE_CUTOFF_HOUR && loadedSitsRef.current == null) {
          try {
            const { sessions } = await api.getSessions();
            if (cancelled || generation !== sessionGeneration.current) return;
            loadedSitsRef.current = sessions.map(practiceDaySit);
          } catch {
            // Leave the cache empty. `creditedPracticeDate` keeps yesterday
            // open before 6:00 so this miss cannot start recovery early.
          }
        }
        if (cancelled || generation !== sessionGeneration.current) return;
        // Dual-track is not known yet. Assume it is on so a finished primary
        // sit does not close a two-a-day schedule; refine after the user lands.
        const date = creditedPracticeDate(loadedSitsRef.current, true, now);
        const res = await fetch(`/api/auth/me?date=${encodeURIComponent(date)}`);
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          // Re-checked after the second await: an unmount between the response
          // and its body must not adopt a user or write the cache.
          if (cancelled || generation !== sessionGeneration.current) return;
          let freshUser = data?.user ?? null;
          if (freshUser && loadedSitsRef.current) {
            const precise = creditedPracticeDate(
              loadedSitsRef.current,
              !!freshUser.dualTrackEnabled,
              now,
            );
            if (precise !== date) {
              const again = await fetch(`/api/auth/me?date=${encodeURIComponent(precise)}`);
              if (cancelled || generation !== sessionGeneration.current) return;
              if (again.ok) {
                const againData = await again.json();
                if (cancelled || generation !== sessionGeneration.current) return;
                if (againData?.user) freshUser = againData.user;
              }
            }
          }
          if (freshUser) {
            setUser(freshUser);
            setRunningFromCache(false);
            setAuthError(null);
            setAuthChecked(true);
            return;
          }
          // A 2xx with no user is the server authoritatively reporting no
          // account — the same cause as a 404 from this route.
          applyFailure({ kind: "status", status: 404 });
          return;
        }

        applyFailure({ kind: "status", status: res.status });
      } catch {
        applyFailure({ kind: "transport" });
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [authRetryKey, sessionGeneration, loadedSitsRef]);

  // #666: coming back online, re-run the bootstrap so the on-screen state
  // refreshes from the server and the offline indicator clears on its own. Only
  // while actually running from cache — a normal online session must not re-auth
  // every time a flaky radio flaps. Queued sits are flushed by the existing
  // `initWebPwaOffline` "online" listener; nothing is duplicated here.
  useEffect(() => {
    if (!isOnline || !runningFromCache) return;
    setAuthRetryKey((prev) => prev + 1);
  }, [isOnline, runningFromCache]);

  // #666: `navigator.onLine` reports link state, not reachability, so the
  // transition above never fires for the failures that leave it pinned at
  // true — a captive portal, a DNS failure, a 5xx. Those sessions would hold the
  // offline strip until a manual reload. Re-checking when the user returns to
  // the tab covers them without polling: it is user-driven so it cannot spin,
  // and coming back to the app is exactly when a stale day number would show.
  // Only while running from cache, for the same reason as above. A double fire
  // (visibility *and* focus) is harmless — the bootstrap effect's cleanup
  // cancels the superseded request.
  useEffect(() => {
    if (!runningFromCache) return;
    const recheck = () => {
      if (document.visibilityState === "visible") setAuthRetryKey((prev) => prev + 1);
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("focus", recheck);
    return () => {
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("focus", recheck);
    };
  }, [runningFromCache]);

  /** The retryable auth-error screen's Retry: back to the loading state, then re-bootstrap. */
  const retryAuth = useCallback(() => {
    setAuthChecked(false);
    setAuthError(null);
    setAuthRetryKey((prev) => prev + 1);
  }, []);

  const signIn = useCallback((userData: User) => {
    sessionGeneration.current += 1;
    const generation = sessionGeneration.current;
    setUser(userData);
    // #238: login returns raw DB fields; missed-day gap detection only runs in
    // GET /api/auth/me. Re-fetch silently so a returning user with a 2+ day gap
    // enters the recovery ramp before their first sit of this session.
    // Guard on the session generation so a slow response can't repopulate user
    // state after an explicit logout before the /api/auth/me response arrives.
    const now = new Date();
    const date = creditedPracticeDate(loadedSitsRef.current, true, now);
    void fetch(`/api/auth/me?date=${encodeURIComponent(date)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (generation === sessionGeneration.current && data?.user) setUser(data.user);
      })
      .catch(() => {});
  }, [sessionGeneration, loadedSitsRef]);

  const signOut = useCallback(() => {
    // Invalidates every user adoption already in flight (#666).
    sessionGeneration.current += 1;
    loadedSitsRef.current = null;
    setUser(null);
    setRunningFromCache(false);
    onAccountTeardownRef.current();
    // #666: an explicit sign-out is the most authoritative signal there is, so
    // the local identity goes with it — including while offline.
    clearCachedUser();
    void getWebSessionSyncCoordinator().clearQueue().catch((error) => {
      console.error("Failed to clear offline session queue on logout:", error);
    });
  }, [sessionGeneration, loadedSitsRef]);

  return {
    user,
    setUser,
    userRef,
    authChecked,
    authError,
    runningFromCache,
    refreshUserFromServer,
    retryAuth,
    signIn,
    signOut,
  };
}
