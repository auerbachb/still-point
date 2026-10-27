"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import type { CalendarSyncResult, User } from "@/lib/api";
import { AuthScreen } from "@/components/AuthScreen";
import { HomeView } from "@/components/HomeView";
import { SessionView } from "@/components/SessionView";
import { BreathCountView } from "@/components/BreathCountView";
import { CompletionScreen } from "@/components/CompletionScreen";
import { HistoryView } from "@/components/HistoryView";
import { ThoughtJournal } from "@/components/ThoughtJournal";
import { PublicBoard } from "@/components/PublicBoard";
import { SettingsView } from "@/components/SettingsView";
import { FriendsView } from "@/components/FriendsView";
import { BuddySessionHub } from "@/components/BuddySessionHub";
import { BuddySessionRoom, type BuddyPersonalRecordPayload } from "@/components/BuddySessionRoom";
import { AppNav } from "@/components/app/AppNav";
import { useIsMobile } from "@/lib/useIsMobile";
import { useOnlineStatus } from "@/lib/useOnlineStatus";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { suppressedOfflineIndicatorState } from "@/lib/offlineIndicatorCopy";
import { api, ApiError } from "@/lib/api";
import { DEFAULT_TAB, isTab, pathForTab, type Tab } from "@/lib/appTabs";
import type { SessionType, Track } from "@/lib/constants";
import { isDualTrackEligible } from "@/lib/duration";
import type { PracticeDaySit } from "@/lib/sessionCalendar";
import { resetTrackingUnlockOnLogout } from "@/lib/trackingControlPrefs";
import { getWebSessionSyncCoordinator } from "@/lib/offlineSessionQueue";
import { resetSessionStateReports } from "@/lib/web-push-client";
import { clearSuppressDuringSessionPref } from "@/lib/sessionSuppressionPrefs";
import { NO_RECOVERY, previewNextStandardDuration, recoveryFieldsOf } from "@/lib/userProgression";
import { useAuthBootstrap } from "@/lib/useAuthBootstrap";
import { useDualTrackFork } from "@/lib/useDualTrackFork";
import { useSessionSaveLifecycle, type CompletionData } from "@/lib/useSessionSaveLifecycle";
import { PwaBootstrap } from "@/components/PwaBootstrap";

// Transient flows that overlay the active tab without changing the URL.
// "breath" hides nav/header and renders BreathCountView full-screen, matching
// the iOS breath-counting mode (#376).
type Overlay = "session" | "breath" | "complete";

/** A completion-note write for a sit that has a server row: a new note, or
 *  `clearCompletionNote` with no thoughts to delete it (#792). A pending sit
 *  writes through the offline queue instead. */
async function postCompletionNoteBatch(
  data: Pick<CompletionData, "sessionId" | "clientSessionId" | "dayNumber">,
  ownerUserId: string,
  body: { thoughts: Array<{ timeInSession: number; text: string }>; clearCompletionNote?: true },
): Promise<void> {
  const failure = body.clearCompletionNote ? "Failed to clear note" : "Failed to save note";
  const sessionId = data.sessionId
    ?? (data.clientSessionId
      ? await getWebSessionSyncCoordinator().resolvedServerSessionId(data.clientSessionId, ownerUserId)
      : null);
  if (!sessionId) {
    throw new Error(failure);
  }
  const res = await fetch("/api/thoughts/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, dayNumber: data.dayNumber, ...body }),
  });
  if (!res.ok) {
    throw new Error(failure);
  }
}

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

  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [activeSessionType, setActiveSessionType] = useState<SessionType>("standard");
  // #240: which track the in-progress standard sit belongs to.
  const [activeTrack, setActiveTrack] = useState<Track>("primary");
  const [buddySessionId, setBuddySessionId] = useState<string | null>(null);
  const [buddyInviteError, setBuddyInviteError] = useState<string | null>(null);
  const [buddyCalendarMessage, setBuddyCalendarMessage] = useState<string | null>(null);
  const buddyInviteInFlight = useRef(false);
  // #666: monotonic session generation. Every async path that adopts a user
  // captures the generation it started in and drops its result if a sign-out —
  // or a *different* sign-in — happened in the meantime. A plain "cancelled"
  // boolean is not enough here: it resets on the next login, so a callback from
  // the previous session could still land and be adopted as the new one.
  // Without this the cache effect in `useAuthBootstrap` would not merely
  // repopulate React state after a logout, it would persist the signed-out
  // account as the offline identity, surviving a reload. Shared with every hook
  // below that adopts state after an await.
  const sessionGeneration = useRef(0);
  // Sits used to decide whether yesterday is still open. Null until a fetch lands.
  const loadedSitsRef = useRef<PracticeDaySit[] | null>(null);
  const isMobile = useIsMobile();
  const isOnline = useOnlineStatus();

  const {
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
  } = useAuthBootstrap({
    sessionGeneration,
    loadedSitsRef,
    isOnline,
    // Declared below, because it clears state owned by the hooks that follow.
    // The auth hook only calls it when an account leaves the screen, never while rendering.
    onAccountTeardown: () => clearAccountScopedLocalState(),
  });

  const {
    tracksDoneToday,
    forkDismissed,
    setForkDismissed,
    refreshTodayTracks,
    handleEnableDualTrack,
    resetForAccount: resetDualTrackFork,
  } = useDualTrackFork({ sessionGeneration, loadedSitsRef, user, userRef, authChecked, setUser });

  const {
    completionData,
    setCompletionData,
    localWriteFailed,
    clearLocalWriteFailed,
    handleSessionComplete,
    handleRetryCompletionSave,
    handleSessionAbandon,
    handleBreathEnd,
  } = useSessionSaveLifecycle({
    sessionGeneration,
    loadedSitsRef,
    user,
    userRef,
    refreshUserFromServer,
    refreshTodayTracks,
    setOverlay,
  });

  const clearAccountScopedLocalState = () => {
    resetDualTrackFork();
    // #703: the not-stored warning is about one account's sit. Left set, the
    // next user to go offline on this device sees a red strip for a failure
    // that was never theirs. Mirrored by `AppViewModel.didLogout` on iOS.
    clearLocalWriteFailed();
    resetTrackingUnlockOnLogout();
    // #709: the suppression mirror is one localStorage key for the whole browser,
    // so leaving it set hands this account's "During sessions: off" to whoever
    // signs in next — and that account then never reports its sit to the server
    // and gets banners mid-sit. Dropping it restores the silent default until
    // their own preference arrives.
    clearSuppressDuringSessionPref();
    // #709: the report queue is account-scoped for the same reason, so it is
    // dropped here rather than at the one call site that used to do it. Both
    // teardowns reach this helper — an explicit sign-out and an authoritative
    // 401/403/404 — and a report still queued under this account would otherwise
    // survive the second of them and drain under the next account's cookie.
    resetSessionStateReports();
  };

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
    // buddy-invite / ?view= effects above can still consume it.
    signIn(userData);
    setOverlay(null);
  };

  const handleLogout = () => {
    signOut();
    buddyInviteInFlight.current = false;
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setOverlay(null);
  };

  const handleBegin = (sessionType: SessionType = "standard", track: Track = "primary") => {
    setActiveSessionType(sessionType);
    setActiveTrack(track);
    setOverlay("session");
  };

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
      // The buddy room records this sit server-side; it never touches the queue.
      notStored: false,
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
  }, [user, setCompletionData, refreshTodayTracks, refreshUserFromServer]);

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
          onClick={retryAuth}
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
  //
  // #717: outside those flows the strip is no longer a connectivity surface. A
  // refused IndexedDB write is not an offline condition, and `handleBreathEnd`
  // and `handleSessionAbandon` have no completion screen to say so on, so the
  // strip has to raise itself for a failed write whether or not the network is
  // up. `suppressedOfflineIndicatorState` applies the immersive and
  // completion-owns gates, then `offlineIndicatorStateFor` owns the remaining
  // rule and the copy that goes with it — `null` is the one combination with
  // nothing to say.
  // #717 (review): the completion overlay is *not* immersive, so a sit that was
  // refused would raise this strip on top of `CompletionScreen`'s own
  // `completion-not-stored` alert — two danger-token surfaces for one loss. The
  // strip is the weaker of the two: it only states the loss, while the alert
  // states it and carries the retry that can still recover the sit, so while
  // that alert is up it owns the message. Suppressed whole rather than
  // downgraded to `offlineSavedProgress`, because that string re-makes the
  // "saved and upload when you reconnect" promise #703 withdrew.
  const completionOwnsNotStored = overlay === "complete" && completionData?.notStored === true;

  const offlineIndicatorState = suppressedOfflineIndicatorState({
    isImmersive,
    completionOwnsNotStored,
    offline: runningFromCache,
    sitNotStored: localWriteFailed,
  });

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
        <AppNav activeTab={overlay ? null : tab} isMobile={isMobile} onSelectTab={goToTab} />
      )}

      {/* Welcome header — hidden during the completion overlay on mobile to
          keep the CompletionScreen content above the fixed bottom nav (#479).
          #666: when the offline strip is up, the two share a single grid item.
          This container's rows are `auto 1fr auto`, so an extra top-level child
          would push the tab content out of the `1fr` track and shrink it. */}
      {offlineIndicatorState ? (
        <div>
          <OfflineIndicator state={offlineIndicatorState} />
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
          notStored={completionData.notStored}
          // #703: only offered while the sit is nowhere; it reuses the original
          // client id, so a retry can never produce a second sit.
          onRetrySave={completionData.notStored ? handleRetryCompletionSave : undefined}
          onReturn={() => {
            setOverlay(null);
            router.push(pathForTab(DEFAULT_TAB));
            refreshUserFromServer();
          }}
          // #703: with nothing stored there is no queue entry to append a note to
          // and no session to post one against, so the field is not offered.
          onSaveNote={completionData.clientSessionId && user && !completionData.notStored ? async (text: string) => {
            if (completionData.isPendingSync) {
              await getWebSessionSyncCoordinator().replaceEndNote(
                completionData.clientSessionId!,
                user.id,
                text,
              );
              return;
            }
            await postCompletionNoteBatch(completionData, user.id, {
              thoughts: [{ timeInSession: -1, text }],
            });
          } : undefined}
          // #792: emptying a saved note deletes it. Same gate and same two paths
          // as the save: the queue while the sit is pending, the server after.
          onClearNote={completionData.clientSessionId && user && !completionData.notStored ? async () => {
            if (completionData.isPendingSync) {
              await getWebSessionSyncCoordinator().clearEndNote(
                completionData.clientSessionId!,
                user.id,
              );
              return;
            }
            await postCompletionNoteBatch(completionData, user.id, {
              thoughts: [],
              clearCompletionNote: true,
            });
          } : undefined}
          onSaveRatings={completionData.sessionId && !completionData.isPendingSync ? async (ratings) => {
            await api.updateSessionRatings(completionData.sessionId!, ratings);
          } : undefined}
          onSaveMoodMatrix={completionData.sessionId && !completionData.isPendingSync ? async (matrix) => {
            await api.updateSessionRatings(completionData.sessionId!, { moodMatrix: matrix });
          } : undefined}
          onClearMoodMatrix={completionData.sessionId && !completionData.isPendingSync ? async () => {
            await api.updateSessionRatings(completionData.sessionId!, { moodMatrix: null });
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
          dualTrackEnabled={!!user.dualTrackEnabled}
        />
      )}

      {!overlay && tab === "history" && (
        <HistoryView
          currentDay={user.currentDay}
          recovery={userRecovery}
          username={user.username}
          dualTrackEnabled={!!user.dualTrackEnabled}
        />
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
