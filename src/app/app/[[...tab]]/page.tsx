"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import type { CalendarSyncResult, User } from "@/lib/api";
import { AuthScreen } from "@/components/AuthScreen";
import { HomeView } from "@/components/HomeView";
import { SessionView } from "@/components/SessionView";
import { BreathCountView, type BreathSessionResult } from "@/components/BreathCountView";
import { CompletionScreen } from "@/components/CompletionScreen";
import { HistoryView } from "@/components/HistoryView";
import { ThoughtJournal } from "@/components/ThoughtJournal";
import { PublicBoard } from "@/components/PublicBoard";
import { SettingsView } from "@/components/SettingsView";
import { FriendsView } from "@/components/FriendsView";
import { BuddySessionHub } from "@/components/BuddySessionHub";
import { BuddySessionRoom, type BuddyPersonalRecordPayload } from "@/components/BuddySessionRoom";
import { useIsMobile } from "@/lib/useIsMobile";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { clearCachedUser, clearCachedUserIfAuthoritative, loadCachedUser, saveCachedUser } from "@/lib/cachedUser";
import { authErrorMessageFor, resolveAuthBootstrap, type MeFailure } from "@/lib/offlineAuth";
import { api, ApiError } from "@/lib/api";
import type { SessionType, Track } from "@/lib/constants";
import { advanceProgression, advanceSecondTrackDay, isDualTrackEligible, sessionDurationForUser, type RecoveryFields } from "@/lib/duration";
import { todayLocalIsoDate } from "@/lib/sessionCalendar";
import { resetTrackingUnlockOnLogout, syncTrackingUnlockFromSessions } from "@/lib/trackingControlPrefs";
import { getWebSessionSyncCoordinator } from "@/lib/offlineSessionQueue";
import { PwaBootstrap } from "@/components/PwaBootstrap";

/** Normalizes `User`'s optional recovery fields (absent on some legacy responses)
 *  into the non-optional shape `@/lib/duration` helpers expect. */
function recoveryFieldsOf(user: Pick<User, "recoveryTargetDay" | "recoveryCurrentStep" | "recoveryTotalSteps">): RecoveryFields {
  return {
    recoveryTargetDay: user.recoveryTargetDay ?? null,
    recoveryCurrentStep: user.recoveryCurrentStep ?? null,
    recoveryTotalSteps: user.recoveryTotalSteps ?? null,
  };
}

const NO_RECOVERY: RecoveryFields = {
  recoveryTargetDay: null,
  recoveryCurrentStep: null,
  recoveryTotalSteps: null,
};

/**
 * Planned duration of the *next* standard sit, previewed client-side from the
 * pre-save user state using the same `advanceProgression` / `sessionDurationForUser`
 * the server applies (#238) — so the completion screen's "tomorrow" preview stays
 * correct whether this sit advanced `currentDay` normally, stepped a recovery ramp,
 * or just completed the final recovery step.
 */
function previewNextStandardDuration(
  sessionType: SessionType,
  completed: boolean,
  track: Track,
  user: User | null,
): number {
  if (!user) return 60;
  // #240: the second track has its own counter and no recovery ramp, so preview
  // its next length independently from the primary track's progression.
  if (track === "second") {
    const nextSecond = advanceSecondTrackDay(sessionType, completed, user.secondTrackDay ?? 1);
    return sessionDurationForUser("standard", nextSecond, NO_RECOVERY);
  }
  const next = advanceProgression(sessionType, completed, {
    currentDay: user.currentDay,
    ...recoveryFieldsOf(user),
  });
  return sessionDurationForUser("standard", next.currentDay, next);
}

// URL-driven tabs. The first path segment of /app/[[...tab]] selects the tab;
// `/app` (no segment) resolves to the Progress tab.
type Tab =
  | "progress"
  | "history"
  | "journal"
  | "board"
  | "friends"
  | "settings"
  | "buddy";

// Tabs that appear in the persistent nav, in display order. `buddy` is reached
// from the Progress screen rather than the nav, so it is intentionally omitted.
const NAV_TABS: Tab[] = ["progress", "history", "journal", "board", "friends", "settings"];

const ALL_TABS: Tab[] = [...NAV_TABS, "buddy"];

const DEFAULT_TAB: Tab = "progress";

// Visible nav labels are decoupled from the route slug: the Progress tab keeps
// its existing "home" label (shorter, so the 6-item mobile nav row stays
// readable) while living at /app/progress.
const TAB_LABELS: Record<Tab, string> = {
  progress: "home",
  history: "history",
  journal: "journal",
  board: "board",
  friends: "friends",
  settings: "settings",
  buddy: "buddy",
};

// Minimal line icons for the mobile bottom tab bar. Pairing each short label
// with an icon lets the six tabs sit with clear spacing at 320px instead of
// colliding as text-only labels did (#473 P1).
const TAB_ICONS: Record<Tab, React.ReactNode> = {
  progress: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </>
  ),
  history: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  journal: (
    <>
      <rect x="5" y="3.5" width="14" height="17" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  board: (
    <>
      <path d="M6 20v-7M12 20V5M18 20v-9" />
    </>
  ),
  friends: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 19.5c0-3 2.6-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.2a3 3 0 0 1 0 5.6" />
      <path d="M16.5 14.6c2.3.4 4 2.3 4 4.9" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h8M16 7h4M4 17h4M12 17h8" />
      <circle cx="14" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
  // Reached from the Progress screen, not the nav row; defined to satisfy the
  // Record<Tab> type.
  buddy: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="16" cy="9" r="2.4" />
      <path d="M3.5 19.5c0-3 2.6-5 5.5-5s5.5 2 5.5 5" />
    </>
  ),
};

function TabIcon({ tab }: { tab: Tab }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {TAB_ICONS[tab]}
    </svg>
  );
}

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && (ALL_TABS as string[]).includes(value);
}

function pathForTab(tab: Tab): string {
  return `/app/${tab}`;
}

// Transient flows that overlay the active tab without changing the URL.
// "breath" hides nav/header and renders BreathCountView full-screen, matching
// the iOS breath-counting mode (#376).
type Overlay = "session" | "breath" | "complete";

type CompletionData = {
  sessionId: string | null;
  /** #558: stable local key for offline end-note sync during completion. */
  clientSessionId: string | null;
  /** #558: true when the sit is queued locally and awaiting server sync. */
  isPendingSync: boolean;
  dayNumber: number;
  sessionType: SessionType;
  /** #240: which daily track this completed sit belonged to. */
  track: Track;
  duration: number;
  bonusSeconds: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
  /** Planned duration of the *next* standard sit, accounting for recovery-ramp
   *  advancement (#238) — computed with the same `advanceProgression` /
   *  `sessionDurationForUser` the server uses, from the pre-save user state. */
  nextDuration: number;
};

function calendarSyncMessageFromResult(sync: CalendarSyncResult[] | undefined): string | null {
  const item = sync?.[0];
  if (!item) return null;
  if (item.status === "created") return "Added this scheduled sit to your Google Calendar.";
  if (item.status === "skipped") return "Google Calendar is not connected on this account.";
  return "Could not add this sit to Google Calendar, but you joined successfully.";
}

export default function StillPoint() {
  const router = useRouter();
  const params = useParams<{ tab?: string[] }>();
  const rawTab = Array.isArray(params.tab) ? params.tab[0] : undefined;
  const tab: Tab = isTab(rawTab) ? rawTab : DEFAULT_TAB;

  const [user, setUser] = useState<User | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRetryKey, setAuthRetryKey] = useState(0);
  const [completionData, setCompletionData] = useState<CompletionData | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<SessionType>("standard");
  // #240: which track the in-progress standard sit belongs to, per-track completion
  // status for today, and whether the fork prompt was dismissed this session.
  const [activeTrack, setActiveTrack] = useState<Track>("primary");
  const [tracksDoneToday, setTracksDoneToday] = useState<{ primary: boolean; second: boolean }>({
    primary: false,
    second: false,
  });
  const [forkDismissed, setForkDismissed] = useState(false);
  const [buddySessionId, setBuddySessionId] = useState<string | null>(null);
  const [buddyInviteError, setBuddyInviteError] = useState<string | null>(null);
  const [buddyCalendarMessage, setBuddyCalendarMessage] = useState<string | null>(null);
  const buddyInviteInFlight = useRef(false);
  // #666: monotonic session generation. Every async path that adopts a user
  // captures the generation it started in and drops its result if a sign-out —
  // or a *different* sign-in — happened in the meantime. A plain "cancelled"
  // boolean is not enough here: it resets on the next login, so a callback from
  // the previous session could still land and be adopted as the new one.
  // Without this the cache effect below would not merely repopulate React state
  // after a logout, it would persist the signed-out account as the offline
  // identity, surviving a reload.
  const sessionGeneration = useRef(0);
  const isMobile = useIsMobile();
  // #666: running the app from the locally cached identity because the server
  // could not be reached. Only a *successful* `/api/auth/me` clears it, mirroring
  // the iOS `isOfflineMode` — `navigator.onLine` reports link state, not
  // reachability, so it prompts a re-check and never concludes one.
  const [runningFromCache, setRunningFromCache] = useState(false);
  const isOnline = useOnlineStatus();

  const clearAccountScopedLocalState = () => {
    setTracksDoneToday({ primary: false, second: false });
    setForkDismissed(false);
    resetTrackingUnlockOnLogout();
  };

  // #666: re-read the user from the server after an action that moves account
  // state (a completed sit advancing the day number, say). The result is dropped
  // if the session changed while the request was in flight — see
  // `sessionGeneration`. One helper rather than three copies of the guard, so a
  // future call site cannot adopt a user without it.
  const refreshUserFromServer = useCallback(() => {
    const generation = sessionGeneration.current;
    void api
      .me()
      .then(({ user: u }) => {
        if (generation === sessionGeneration.current) setUser(u);
      })
      .catch(() => {});
  }, []);

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
        setUser(null);
        // Teardown is gated on the one shared predicate — asked once, through
        // the cached-identity store, whose answer then gates the rest (the iOS
        // `clearIfAuthoritative` shape). Not on "the request failed", which is
        // the bug #665/#666 exist to remove.
        if (clearCachedUserIfAuthoritative(outcome.cause)) {
          clearAccountScopedLocalState();
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
        const res = await fetch(`/api/auth/me?date=${todayLocalIsoDate()}`);
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          // Re-checked after the second await: an unmount between the response
          // and its body must not adopt a user or write the cache.
          if (cancelled || generation !== sessionGeneration.current) return;
          const freshUser = data?.user ?? null;
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
  }, [authRetryKey]);

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

  // Redirect legacy `?view=` deep links and unknown tab slugs to their routes.
  useEffect(() => {
    if (!user || !authChecked) return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get("view");
    if (viewParam === "settings") {
      router.replace(pathForTab("settings"));
      return;
    }
    if (viewParam === "friends") {
      router.replace(pathForTab("friends"));
      return;
    }
    // Unknown slug (e.g. /app/garbage) falls back to Progress.
    if (rawTab !== undefined && !isTab(rawTab)) {
      router.replace(pathForTab(DEFAULT_TAB));
    }
  }, [user, authChecked, rawTab, router]);

  // Deep link to auto-start a sit, e.g. /app?session=quick from the failure-reason
  // log page's post-save CTA (#441). Consume the param so a refresh won't re-trigger.
  useEffect(() => {
    if (!user || !authChecked) return;
    const sessionParam = new URLSearchParams(window.location.search).get("session");
    if (sessionParam !== "quick" && sessionParam !== "standard") return;
    setActiveSessionType(sessionParam);
    // #240: this deep-link path bypasses handleBegin, which normally sets the
    // track explicitly — without this, a stale `second` track from an earlier
    // interaction would incorrectly attribute this auto-started sit.
    setActiveTrack("primary");
    setOverlay("session");
    router.replace(rawTab && isTab(rawTab) ? pathForTab(rawTab) : pathForTab(DEFAULT_TAB));
  }, [user, authChecked, rawTab, router]);

  useEffect(() => {
    if (!user || !authChecked || buddyInviteInFlight.current) return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get("buddy")?.trim();
    if (!raw) return;

    buddyInviteInFlight.current = true;
    let cancelled = false;

    (async () => {
      try {
        const { sessionId, calendarSync } = await api.joinBuddySession(raw);
        if (cancelled) return;
        setBuddyInviteError(null);
        setBuddyCalendarMessage(calendarSyncMessageFromResult(calendarSync));
        setBuddySessionId(sessionId);
        setOverlay(null);
        buddyInviteInFlight.current = false;
        router.replace(pathForTab("buddy"));
      } catch (e) {
        if (!cancelled) {
          buddyInviteInFlight.current = false;
          setBuddyInviteError(
            e instanceof ApiError ? e.message : "Could not open that buddy invite.",
          );
          // Strip the consumed invite token from whatever tab URL we are on.
          router.replace(rawTab && isTab(rawTab) ? pathForTab(rawTab) : pathForTab(DEFAULT_TAB));
        }
      }
    })();

    return () => {
      cancelled = true;
      buddyInviteInFlight.current = false;
    };
  }, [user, authChecked, rawTab, router]);

  // Reset scroll to the top whenever the active view changes. Without this,
  // opening a session/overlay from a scrolled tab (e.g. the long Home page)
  // inherits the old scroll offset and lands mid-screen, hiding the timer at
  // the top of the session view (#473 P2).
  // Only scroll when an overlay OPENS (becomes non-null); closing an overlay
  // should restore the underlying tab's scroll position, not reset it.
  useEffect(() => {
    if (typeof window !== "undefined" && overlay !== null) {
      window.scrollTo(0, 0);
    }
  }, [overlay]);
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo(0, 0);
    }
  }, [tab, buddySessionId]);

  // Keep transient state in sync with the URL. Browser back/forward (and any
  // other navigation) changes the active tab via useParams without touching
  // React state, so clear the session/completion overlay and drop any stale
  // buddy room when we land on a different tab. This runs only when `tab`
  // actually changes, so it never interferes with starting a session/overlay
  // on the current tab.
  useEffect(() => {
    setOverlay(null);
    if (tab !== "buddy") {
      setBuddySessionId(null);
    }
  }, [tab]);

  const goToTab = useCallback(
    (next: Tab) => {
      setOverlay(null);
      router.push(pathForTab(next));
    },
    [router],
  );

  const handleLogin = (userData: User) => {
    // Intentionally do not navigate: keep the current URL so deep-link state
    // (e.g. /app?buddy=<token> or a deep-linked tab) survives sign-in and the
    // buddy-invite / ?view= effects below can still consume it.
    sessionGeneration.current += 1;
    const generation = sessionGeneration.current;
    setUser(userData);
    setOverlay(null);
    // #238: login returns raw DB fields; missed-day gap detection only runs in
    // GET /api/auth/me. Re-fetch silently so a returning user with a 2+ day gap
    // enters the recovery ramp before their first sit of this session.
    // Guard on the session generation so a slow response can't repopulate user
    // state after an explicit logout before the /api/auth/me response arrives.
    void fetch(`/api/auth/me?date=${todayLocalIsoDate()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (generation === sessionGeneration.current && data?.user) setUser(data.user);
      })
      .catch(() => {});
  };

  const handleLogout = () => {
    // Invalidates every user adoption already in flight (#666).
    sessionGeneration.current += 1;
    buddyInviteInFlight.current = false;
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setOverlay(null);
    setUser(null);
    setRunningFromCache(false);
    clearAccountScopedLocalState();
    // #666: an explicit sign-out is the most authoritative signal there is, so
    // the local identity goes with it — including while offline.
    clearCachedUser();
    void getWebSessionSyncCoordinator().clearQueue().catch((error) => {
      console.error("Failed to clear offline session queue on logout:", error);
    });
  };

  const handleBegin = (sessionType: SessionType = "standard", track: Track = "primary") => {
    setActiveSessionType(sessionType);
    setActiveTrack(track);
    setOverlay("session");
  };

  // #240: derive per-track "completed a standard sit today" from the session list,
  // to drive HomeView's completion badges. A missing `track` (pre-#240 row) counts
  // as the primary track.
  const refreshTodayTracks = useCallback(async () => {
    try {
      const { sessions } = await api.getSessions();
      const today = todayLocalIsoDate();
      let primary = false;
      let second = false;
      for (const s of sessions) {
        if (s.completed && s.sessionType === "standard" && s.sessionDate === today) {
          if (s.track === "second") second = true;
          else primary = true;
        }
      }
      syncTrackingUnlockFromSessions(sessions);
      setTracksDoneToday({ primary, second });
    } catch {
      // Fail closed so a failed refresh can't leave a stale "done today"
      // badge on screen (e.g. after switching accounts).
      setTracksDoneToday({ primary: false, second: false });
    }
  }, []);

  const handleEnableDualTrack = useCallback(async () => {
    const generation = sessionGeneration.current;
    const { user: updated } = await api.enableDualTrack();
    if (generation !== sessionGeneration.current) return;
    setUser(updated);
    void refreshTodayTracks();
  }, [refreshTodayTracks]);

  // #240: load per-track completion badges once a user is present.
  useEffect(() => {
    if (!user || !authChecked) return;
    void refreshTodayTracks();
  }, [user?.id, authChecked, refreshTodayTracks]);

  const handleBuddyExit = useCallback(() => {
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setBuddyInviteError(null);
    setOverlay(null);
    router.push(pathForTab(DEFAULT_TAB));
  }, [router]);

  const handleBuddyPersonalRecordComplete = useCallback((data: BuddyPersonalRecordPayload) => {
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setCompletionData({
      sessionId: data.sessionId,
      clientSessionId: null,
      isPendingSync: false,
      dayNumber: data.dayNumber,
      sessionType: "standard",
      // Buddy sits always count toward the primary track (#240).
      track: "primary",
      duration: data.duration,
      bonusSeconds: 0,
      clearPercent: data.clearPercent,
      thoughtCount: data.thoughtCount,
      thoughts: data.thoughts,
      nextDuration: previewNextStandardDuration("standard", true, "primary", user),
    });
    setOverlay("complete");
    refreshUserFromServer();
    void refreshTodayTracks();
  }, [user, refreshTodayTracks, refreshUserFromServer]);

  const handleSessionComplete = useCallback(async (data: {
    dayNumber: number;
    sessionType: SessionType;
    track: Track;
    duration: number;
    bonusSeconds: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => {
    const clientSessionId = crypto.randomUUID();
    let savedSessionId: string | null = null;
    let isPendingSync = false;

    if (user?.id) {
      try {
        const coordinator = getWebSessionSyncCoordinator();
        const result = await coordinator.saveCompletedSession(
          {
            dayNumber: data.dayNumber,
            sessionType: data.sessionType,
            track: data.track,
            duration: data.duration,
            bonusSeconds: data.bonusSeconds,
            completed: data.completed,
            actualTime: data.actualTime,
            clearPercent: data.clearPercent,
            thoughtCount: data.thoughtCount,
            mindStateLog: data.mindStateLog,
            sessionDate: todayLocalIsoDate(),
          },
          clientSessionId,
          user.id,
          data.thoughts,
        );
        savedSessionId = result.sessionId;
        isPendingSync = result.isPendingSync;

        if (data.completed && data.sessionType === "standard" && !isPendingSync) {
          refreshUserFromServer();
          void refreshTodayTracks();
        } else if (data.completed && data.sessionType === "standard" && isPendingSync) {
          void refreshTodayTracks();
        }
      } catch (error) {
        console.error("Failed to save session:", error);
        isPendingSync = true;
        savedSessionId = clientSessionId;
      }
    }

    setCompletionData({
      sessionId: savedSessionId,
      clientSessionId,
      isPendingSync,
      dayNumber: data.dayNumber,
      sessionType: data.sessionType,
      track: data.track,
      duration: data.duration,
      bonusSeconds: data.bonusSeconds,
      clearPercent: data.clearPercent,
      thoughtCount: data.thoughtCount,
      thoughts: data.thoughts,
      nextDuration: previewNextStandardDuration(data.sessionType, data.completed, data.track, user),
    });
    setOverlay("complete");
  }, [user, refreshTodayTracks, refreshUserFromServer]);

  const handleSessionAbandon = useCallback(async (data: {
    dayNumber: number;
    sessionType: SessionType;
    track: Track;
    duration: number;
    bonusSeconds: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => {
    if (user?.id) {
      try {
        const clientSessionId = crypto.randomUUID();
        await getWebSessionSyncCoordinator().saveCompletedSession(
          {
            dayNumber: data.dayNumber,
            sessionType: data.sessionType,
            track: data.track,
            duration: data.duration,
            bonusSeconds: data.bonusSeconds,
            completed: false,
            actualTime: data.actualTime,
            clearPercent: data.clearPercent,
            thoughtCount: data.thoughtCount,
            mindStateLog: data.mindStateLog,
            sessionDate: todayLocalIsoDate(),
          },
          clientSessionId,
          user.id,
          data.thoughts,
        );
      } catch (error) {
        console.error("Failed to save abandoned session:", error);
      }
    }

    setOverlay(null);
  }, [user]);

  // #376: log a breath-counting session, mirroring iOS `completeBreathSession`
  // (#374). Empty sessions (entered then ended with no taps) are not logged.
  // Breath sits do not advance the daily progression, and there is no
  // completion screen — End returns straight to the Progress tab.
  const breathSavingRef = useRef(false);
  const handleBreathEnd = useCallback(async (result: BreathSessionResult) => {
    // A session is empty only when no tap was ever recorded. Using tapCount
    // (not the derived elapsedSeconds/breathCount) avoids dropping a real
    // session where End was pressed within the first second of the first tap,
    // which produces elapsedSeconds=0 and breathCount=0 but tapCount>0.
    if (result.tapCount <= 0) {
      setOverlay(null);
      return;
    }
    if (breathSavingRef.current) return;
    breathSavingRef.current = true;
    try {
      if (user?.id) {
        const clientSessionId = crypto.randomUUID();
        await getWebSessionSyncCoordinator().saveCompletedSession(
          {
            dayNumber: user.currentDay ?? 1,
            sessionType: "breath",
            duration: Math.max(result.elapsedSeconds, 1),
            bonusSeconds: 0,
            completed: true,
            actualTime: result.elapsedSeconds,
            clearPercent: 0,
            thoughtCount: 0,
            breathCount: result.breathCount,
            mindStateLog: [],
            sessionDate: todayLocalIsoDate(),
          },
          clientSessionId,
          user.id,
          [],
        );
      }
    } catch (error) {
      console.error("Failed to save breath session:", error);
    } finally {
      breathSavingRef.current = false;
      setOverlay(null);
    }
  }, [user]);

  const inBuddyRoom = tab === "buddy" && !!buddySessionId;
  const isImmersive = overlay === "session" || overlay === "breath" || inBuddyRoom;

  // Loading state
  if (!authChecked) {
    return (
      <div style={{
        minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-serif)",
      }}>
        <div style={{
          fontSize: "42px", fontWeight: 300, fontStyle: "italic",
          color: "var(--fg-4)", animation: "breathe 4s ease-in-out infinite",
        }}>
          Still Point
        </div>
      </div>
    );
  }

  if (authError) {
    return (
      <>
        <PwaBootstrap ownerUserId={null} />
        <div style={{
        minHeight: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: "var(--s3)",
        fontFamily: "var(--font-serif)",
        padding: "40px 20px",
        textAlign: "center",
      }}>
        <div style={{ fontSize: "28px", fontStyle: "italic", color: "var(--fg)" }}>
          Still Point
        </div>
        <p style={{ maxWidth: "44ch", color: "var(--fg-2)", lineHeight: 1.5 }}>
          {authError}
        </p>
        <button
          type="button"
          onClick={() => {
            setAuthChecked(false);
            setAuthError(null);
            setAuthRetryKey((prev) => prev + 1);
          }}
          style={{
            border: "1px solid var(--border-2)",
            background: "transparent",
            color: "var(--fg)",
            borderRadius: "999px",
            padding: "10px 16px",
            cursor: "pointer",
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Retry
        </button>
      </div>
      </>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <>
        <PwaBootstrap ownerUserId={null} />
        <div style={{
        minHeight: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-serif)",
        padding: "40px 20px",
      }}>
        <AuthScreen onLogin={handleLogin} />
      </div>
      </>
    );
  }

  const userRecovery = recoveryFieldsOf(user);

  // #666: the strip is hidden in immersive flows for the same reason the nav and
  // header are — nothing competes with a sit.
  const showOfflineIndicator = runningFromCache && !isImmersive;

  const welcomeHeader = !isImmersive && !(overlay === "complete" && isMobile) ? (
    <div style={{
      fontFamily: "var(--font-mono)",
      fontSize: "12px", color: "var(--fg-3)",
      letterSpacing: "0.12em",
      fontWeight: 400,
      textAlign: "center",
      paddingTop: isMobile ? "var(--s1)" : "var(--s5)",
      marginBottom: "var(--s4)",
    }}>
      <span style={{ textTransform: "uppercase" }}>Welcome, </span>{user.username}
    </div>
  ) : null;

  // Logged in
  return (
    <>
      <PwaBootstrap ownerUserId={user.id} onSynced={refreshUserFromServer} />
      <div style={{
      minHeight: "100%",
      display: "grid",
      gridTemplateRows: isImmersive ? "1fr" : "auto 1fr auto",
      // Immersive flows (session/breath/buddy) can exceed the viewport on small
      // phones; centering would clip the timer off the top with no way to scroll
      // up to it. Pin them to the top so the timer is always visible (#473 P2).
      // The completion overlay can also overflow on mobile now that it includes
      // survey sliders; centering would clip content above the viewport and push
      // the Return button behind the fixed bottom nav (#479). Use "start" on
      // mobile so the bottom padding reliably clears the nav.
      alignItems: (isImmersive || (overlay === "complete" && isMobile)) ? "start" : "center",
      fontFamily: "var(--font-serif)",
      padding: isMobile
        ? "var(--s4) var(--s3) calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))"
        : "var(--s4) var(--s4)",
    }}>
      {/* Nav */}
      {!isImmersive && (
        <div style={isMobile ? {
          position: "fixed", bottom: 0, left: 0, right: 0,
          display: "flex", justifyContent: "space-around",
          background: "rgba(var(--bg-rgb), 0.92)", backdropFilter: "blur(10px)",
          borderTop: "1px solid var(--border-1)",
          padding: "10px 6px env(safe-area-inset-bottom, 8px)",
          zIndex: 100,
        } : {
          position: "fixed", top: "var(--s4)", right: "var(--s4)",
          display: "flex", gap: "var(--s3)",
          zIndex: 100,
        }}>
          {NAV_TABS.map(t => {
            const active = !overlay && tab === t;
            return (
            <button
              type="button"
              key={t}
              aria-label={TAB_LABELS[t]}
              aria-current={active ? "page" : undefined}
              onClick={() => goToTab(t)}
              style={{
                background: "none", border: "none",
                color: active ? "var(--fg)" : "var(--fg-2)",
                fontFamily: "var(--font-mono)",
                fontSize: isMobile ? "9px" : "11px",
                letterSpacing: isMobile ? "0.02em" : "0.1em",
                textTransform: "uppercase",
                cursor: "pointer",
                padding: isMobile ? "6px 2px 8px" : "8px",
                minWidth: isMobile ? "44px" : undefined,
                minHeight: isMobile ? "44px" : undefined,
                lineHeight: 1.2,
                display: "inline-flex",
                flexDirection: isMobile ? "column" : "row",
                alignItems: "center", justifyContent: "center",
                gap: isMobile ? "3px" : undefined,
                transition: "color 0.3s",
                position: "relative",
              }}
            >
              {isMobile && <TabIcon tab={t} />}
              <span>{TAB_LABELS[t]}</span>
              {active && isMobile && (
                <span style={{
                  position: "absolute", bottom: "2px", left: "50%", transform: "translateX(-50%)",
                  width: "16px", height: "2px", borderRadius: "1px",
                  background: "var(--fg)",
                }} />
              )}
            </button>
          );})}
        </div>
      )}

      {/* Welcome header — hidden during the completion overlay on mobile to
          keep the CompletionScreen content above the fixed bottom nav (#479).
          #666: when the offline strip is up, the two share a single grid item.
          This container's rows are `auto 1fr auto`, so an extra top-level child
          would push the tab content out of the `1fr` track and shrink it. */}
      {showOfflineIndicator ? (
        <div>
          <OfflineIndicator />
          {welcomeHeader}
        </div>
      ) : (
        welcomeHeader
      )}

      {buddyInviteError && overlay !== "session" && (
        <div
          role="alert"
          style={{
            maxWidth: "480px",
            width: "100%",
            margin: "0 auto var(--s3)",
            padding: "12px 16px",
            borderRadius: "10px",
            border: "1px solid var(--border-2)",
            background: "var(--surface-1)",
            color: "var(--fg-2)",
            fontSize: "14px",
            lineHeight: 1.45,
            display: "flex",
            flexDirection: "column",
            gap: "var(--s2)",
            alignItems: "stretch",
          }}
        >
          <span>{buddyInviteError}</span>
          <button
            type="button"
            onClick={() => setBuddyInviteError(null)}
            style={{
              alignSelf: "flex-end",
              border: "none",
              background: "transparent",
              color: "var(--fg-3)",
              cursor: "pointer",
              fontSize: "12px",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              textDecoration: "underline",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Transient overlays take precedence over the active tab. */}
      {overlay === "session" && (
        <SessionView
          // #240: the second track uses its own day counter and has no recovery ramp.
          currentDay={activeTrack === "second" ? (user.secondTrackDay ?? 1) : user.currentDay}
          recovery={activeTrack === "second" ? NO_RECOVERY : userRecovery}
          sessionType={activeSessionType}
          track={activeTrack}
          onComplete={handleSessionComplete}
          onAbandon={handleSessionAbandon}
        />
      )}

      {overlay === "breath" && (
        <BreathCountView onEnd={handleBreathEnd} />
      )}

      {overlay === "complete" && completionData && (
        <CompletionScreen
          dayNumber={completionData.dayNumber}
          sessionType={completionData.sessionType}
          duration={completionData.duration}
          bonusSeconds={completionData.bonusSeconds}
          clearPercent={completionData.clearPercent}
          thoughtCount={completionData.thoughtCount}
          thoughts={completionData.thoughts}
          nextDuration={completionData.nextDuration}
          onReturn={() => {
            setOverlay(null);
            router.push(pathForTab(DEFAULT_TAB));
            refreshUserFromServer();
          }}
          onSaveNote={completionData.clientSessionId && user ? async (text: string) => {
            const coordinator = getWebSessionSyncCoordinator();
            if (completionData.isPendingSync) {
              await coordinator.appendEndNote(
                completionData.clientSessionId!,
                user.id,
                text,
              );
              return;
            }
            const sessionId = completionData.sessionId
              ?? (await coordinator.resolvedServerSessionId(
                completionData.clientSessionId!,
                user.id,
              ));
            if (!sessionId) {
              throw new Error("Failed to save note");
            }
            const res = await fetch("/api/thoughts/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId,
                dayNumber: completionData.dayNumber,
                thoughts: [{ timeInSession: -1, text }],
              }),
            });
            if (!res.ok) {
              throw new Error("Failed to save note");
            }
          } : undefined}
          onSaveRatings={completionData.sessionId && !completionData.isPendingSync ? async (ratings) => {
            await api.updateSessionRatings(completionData.sessionId!, ratings);
          } : undefined}
          onSaveMoodMatrix={completionData.sessionId && !completionData.isPendingSync ? async (matrix) => {
            await api.updateSessionRatings(completionData.sessionId!, { moodMatrix: matrix });
          } : undefined}
          compact={isMobile}
        />
      )}

      {/* Tab content (rendered when no transient overlay is active). */}
      {!overlay && tab === "progress" && (
        <HomeView
          currentDay={user.currentDay}
          aphorismsEnabled={user.aphorismsEnabled}
          recovery={userRecovery}
          dualTrackEnabled={user.dualTrackEnabled ?? false}
          secondTrackDay={user.secondTrackDay ?? 1}
          dualTrackEligible={isDualTrackEligible(user.currentDay) && !forkDismissed}
          primaryDoneToday={tracksDoneToday.primary}
          secondDoneToday={tracksDoneToday.second}
          onBegin={() => handleBegin("standard", "primary")}
          onBeginSecond={() => handleBegin("standard", "second")}
          onEnableDualTrack={handleEnableDualTrack}
          onDismissFork={() => setForkDismissed(true)}
          onQuickBegin={() => handleBegin("quick")}
          onBreath={() => setOverlay("breath")}
          onBuddy={() => {
            setBuddySessionId(null);
            setBuddyCalendarMessage(null);
            setBuddyInviteError(null);
            goToTab("buddy");
          }}
        />
      )}

      {!overlay && tab === "buddy" && !buddySessionId && (
        <BuddySessionHub
          onEnterSession={(id, calendarSync) => {
            setBuddyCalendarMessage(calendarSyncMessageFromResult(calendarSync ?? undefined));
            setBuddySessionId(id);
          }}
          onBack={handleBuddyExit}
        />
      )}

      {!overlay && tab === "buddy" && buddySessionId && (
        <BuddySessionRoom
          sessionId={buddySessionId}
          currentUserId={user.id}
          calendarMessage={buddyCalendarMessage}
          onExit={handleBuddyExit}
          onPersonalRecordComplete={handleBuddyPersonalRecordComplete}
        />
      )}

      {!overlay && tab === "history" && (
        <HistoryView currentDay={user.currentDay} recovery={userRecovery} username={user.username} />
      )}

      {!overlay && tab === "journal" && (
        <ThoughtJournal username={user.username} />
      )}

      {!overlay && tab === "board" && (
        <PublicBoard currentUsername={user.username} />
      )}

      {!overlay && tab === "friends" && <FriendsView />}

      {!overlay && tab === "settings" && (
        <SettingsView
          user={user}
          onTogglePublic={(isPublic) =>
            setUser((prev) => (prev ? { ...prev, isPublic } : prev))
          }
          onToggleAphorisms={(aphorismsEnabled) =>
            setUser((prev) => (prev ? { ...prev, aphorismsEnabled } : prev))
          }
          onUsernameChange={(username) =>
            setUser((prev) => (prev ? { ...prev, username } : prev))
          }
          onLogout={handleLogout}
        />
      )}
    </div>
    </>
  );
}
