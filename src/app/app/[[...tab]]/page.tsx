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
import { api, ApiError } from "@/lib/api";
import type { SessionType } from "@/lib/constants";
import { todayLocalIsoDate } from "@/lib/sessionCalendar";

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
  dayNumber: number;
  sessionType: SessionType;
  duration: number;
  bonusSeconds: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
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
  const [buddySessionId, setBuddySessionId] = useState<string | null>(null);
  const [buddyInviteError, setBuddyInviteError] = useState<string | null>(null);
  const [buddyCalendarMessage, setBuddyCalendarMessage] = useState<string | null>(null);
  const buddyInviteInFlight = useRef(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let cancelled = false;

    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          setUser(data?.user ?? null);
          setAuthError(null);
          setAuthChecked(true);
          return;
        }

        if (res.status === 401 || res.status === 403) {
          setUser(null);
          setAuthError(null);
          setAuthChecked(true);
          return;
        }

        if (res.status >= 500) {
          setAuthError("Unable to verify your sign-in due to a server issue. Please retry.");
          setAuthChecked(true);
          return;
        }

        setUser(null);
        setAuthError(null);
        setAuthChecked(true);
      } catch {
        if (!cancelled) {
          setAuthError("Unable to verify your sign-in due to a network issue. Please retry.");
          setAuthChecked(true);
        }
      }
    }

    checkAuth();

    return () => {
      cancelled = true;
    };
  }, [authRetryKey]);

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
    setUser(userData);
    setOverlay(null);
  };

  const handleLogout = () => {
    buddyInviteInFlight.current = false;
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setOverlay(null);
    setUser(null);
  };

  const handleBegin = (sessionType: SessionType = "standard") => {
    setActiveSessionType(sessionType);
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
      dayNumber: data.dayNumber,
      sessionType: "standard",
      duration: data.duration,
      bonusSeconds: 0,
      clearPercent: data.clearPercent,
      thoughtCount: data.thoughtCount,
      thoughts: data.thoughts,
    });
    setOverlay("complete");
    void api
      .me()
      .then(({ user: u }) => setUser(u))
      .catch(() => {});
  }, []);

  const handleSessionComplete = useCallback(async (data: {
    dayNumber: number;
    sessionType: SessionType;
    duration: number;
    bonusSeconds: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => {
    let savedSessionId: string | null = null;

    try {
      // Save session
      const sessionRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayNumber: data.dayNumber,
          sessionType: data.sessionType,
          duration: data.duration,
          bonusSeconds: data.bonusSeconds,
          completed: data.completed,
          actualTime: data.actualTime,
          clearPercent: data.clearPercent,
          thoughtCount: data.thoughtCount,
          mindStateLog: data.mindStateLog,
          sessionDate: todayLocalIsoDate(),
        }),
      });

      if (!sessionRes.ok) {
        console.error("Failed to save session:", await sessionRes.text());
      } else {
        const sessionData = await sessionRes.json();
        savedSessionId = sessionData.session?.id ?? null;

        // Save thoughts if any
        if (data.thoughts.length > 0 && savedSessionId) {
          await fetch("/api/thoughts/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: savedSessionId,
              dayNumber: data.dayNumber,
              thoughts: data.thoughts,
            }),
          });
        }

        // Update local user state
        if (data.completed && data.sessionType === "standard" && user) {
          setUser({ ...user, currentDay: user.currentDay + 1 });
        }
      }
    } catch (error) {
      console.error("Failed to save session:", error);
    }

    setCompletionData({
      sessionId: savedSessionId,
      dayNumber: data.dayNumber,
      sessionType: data.sessionType,
      duration: data.duration,
      bonusSeconds: data.bonusSeconds,
      clearPercent: data.clearPercent,
      thoughtCount: data.thoughtCount,
      thoughts: data.thoughts,
    });
    setOverlay("complete");
  }, [user]);

  const handleSessionAbandon = useCallback(async (data: {
    dayNumber: number;
    sessionType: SessionType;
    duration: number;
    bonusSeconds: number;
    completed: boolean;
    actualTime: number;
    clearPercent: number;
    thoughtCount: number;
    mindStateLog: Array<{ time: number; state: string }>;
    thoughts: Array<{ timeInSession: number; text: string }>;
  }) => {
    try {
      // Save abandoned session
      const sessionRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayNumber: data.dayNumber,
          sessionType: data.sessionType,
          duration: data.duration,
          bonusSeconds: data.bonusSeconds,
          completed: false,
          actualTime: data.actualTime,
          clearPercent: data.clearPercent,
          thoughtCount: data.thoughtCount,
          mindStateLog: data.mindStateLog,
          sessionDate: todayLocalIsoDate(),
        }),
      });

      if (sessionRes.ok) {
        const sessionData = await sessionRes.json();

        if (data.thoughts.length > 0 && sessionData.session?.id) {
          await fetch("/api/thoughts/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: sessionData.session.id,
              dayNumber: data.dayNumber,
              thoughts: data.thoughts,
            }),
          });
        }
      }
    } catch (error) {
      console.error("Failed to save abandoned session:", error);
    }

    setOverlay(null);
  }, []);

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
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dayNumber: user?.currentDay ?? 1,
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
        }),
      });
      if (!res.ok) {
        console.error("Failed to save breath session: HTTP", res.status);
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
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
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
      <div style={{
        minHeight: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        gap: "var(--s3)",
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
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
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "12px",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // Not logged in
  if (!user) {
    return (
      <div style={{
        minHeight: "100%", display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
        padding: "40px 20px",
      }}>
        <AuthScreen onLogin={handleLogin} />
      </div>
    );
  }

  // Logged in
  return (
    <div style={{
      minHeight: "100%",
      display: "grid",
      gridTemplateRows: isImmersive ? "1fr" : "auto 1fr auto",
      // Immersive flows (session/breath/buddy) can exceed the viewport on small
      // phones; centering would clip the timer off the top with no way to scroll
      // up to it. Pin them to the top so the timer is always visible (#473 P2).
      alignItems: isImmersive ? "start" : "center",
      fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
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
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
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

      {/* Welcome header */}
      {!isImmersive && (
        <div style={{
          fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
          fontSize: "12px", color: "var(--fg-3)",
          letterSpacing: "0.12em",
          fontWeight: 400,
          textAlign: "center",
          paddingTop: isMobile ? "var(--s1)" : "var(--s5)",
          marginBottom: "var(--s4)",
        }}>
          <span style={{ textTransform: "uppercase" }}>Welcome, </span>{user.username}
        </div>
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
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
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
          currentDay={user.currentDay}
          sessionType={activeSessionType}
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
          onReturn={() => {
            setOverlay(null);
            router.push(pathForTab(DEFAULT_TAB));
            void api
              .me()
              .then(({ user: u }) => setUser(u))
              .catch(() => {});
          }}
          onSaveNote={completionData.sessionId ? async (text: string) => {
            const res = await fetch("/api/thoughts/batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: completionData.sessionId,
                dayNumber: completionData.dayNumber,
                thoughts: [{ timeInSession: -1, text }],
              }),
            });
            if (!res.ok) {
              throw new Error("Failed to save note");
            }
          } : undefined}
          onSaveRatings={completionData.sessionId ? async (ratings) => {
            await api.updateSessionRatings(completionData.sessionId!, ratings);
          } : undefined}
          compact={isMobile}
        />
      )}

      {/* Tab content (rendered when no transient overlay is active). */}
      {!overlay && tab === "progress" && (
        <HomeView
          currentDay={user.currentDay}
          aphorismsEnabled={user.aphorismsEnabled}
          onBegin={() => handleBegin("standard")}
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
        <HistoryView currentDay={user.currentDay} username={user.username} />
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
  );
}
