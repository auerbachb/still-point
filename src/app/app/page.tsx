"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { CalendarSyncResult, User } from "@/lib/api";
import { AuthScreen } from "@/components/AuthScreen";
import { HomeView } from "@/components/HomeView";
import { SessionView } from "@/components/SessionView";
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

type View =
  | "home"
  | "session"
  | "buddy"
  | "complete"
  | "history"
  | "journal"
  | "board"
  | "friends"
  | "settings";

type CompletionData = {
  sessionId: string | null;
  dayNumber: number;
  duration: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
};

function getLocalIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function calendarSyncMessageFromResult(sync: CalendarSyncResult[] | undefined): string | null {
  const item = sync?.[0];
  if (!item) return null;
  if (item.status === "created") return "Added this scheduled sit to your Google Calendar.";
  if (item.status === "skipped") return "Google Calendar is not connected on this account.";
  return "Could not add this sit to Google Calendar, but you joined successfully.";
}

export default function StillPoint() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("home");
  const [authChecked, setAuthChecked] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authRetryKey, setAuthRetryKey] = useState(0);
  const [completionData, setCompletionData] = useState<CompletionData | null>(null);
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
        setView("buddy");
        window.history.replaceState({}, "", "/app");
      } catch (e) {
        if (!cancelled) {
          buddyInviteInFlight.current = false;
          setBuddyInviteError(
            e instanceof ApiError ? e.message : "Could not open that buddy invite.",
          );
          window.history.replaceState({}, "", "/app");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, authChecked]);

  const handleLogin = (userData: User) => {
    setUser(userData);
    setView("home");
  };

  const handleLogout = () => {
    buddyInviteInFlight.current = false;
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setUser(null);
    setView("home");
  };

  const handleBegin = () => {
    setView("session");
  };

  const handleBuddyExit = useCallback(() => {
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setBuddyInviteError(null);
    setView("home");
  }, []);

  const handleBuddyPersonalRecordComplete = useCallback((data: BuddyPersonalRecordPayload) => {
    setBuddySessionId(null);
    setBuddyCalendarMessage(null);
    setCompletionData({
      sessionId: data.sessionId,
      dayNumber: data.dayNumber,
      duration: data.duration,
      clearPercent: data.clearPercent,
      thoughtCount: data.thoughtCount,
      thoughts: data.thoughts,
    });
    setView("complete");
    void api
      .me()
      .then(({ user: u }) => setUser(u))
      .catch(() => {});
  }, []);

  const handleSessionComplete = useCallback(async (data: {
    dayNumber: number;
    duration: number;
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
          duration: data.duration,
          completed: data.completed,
          actualTime: data.actualTime,
          clearPercent: data.clearPercent,
          thoughtCount: data.thoughtCount,
          mindStateLog: data.mindStateLog,
          sessionDate: getLocalIsoDate(),
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
        if (data.completed && user) {
          setUser({ ...user, currentDay: user.currentDay + 1 });
        }
      }
    } catch (error) {
      console.error("Failed to save session:", error);
    }

    setCompletionData({
      sessionId: savedSessionId,
      dayNumber: data.dayNumber,
      duration: data.duration,
      clearPercent: data.clearPercent,
      thoughtCount: data.thoughtCount,
      thoughts: data.thoughts,
    });
    setView("complete");
  }, [user]);

  const handleSessionAbandon = useCallback(async (data: {
    dayNumber: number;
    duration: number;
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
          duration: data.duration,
          completed: false,
          actualTime: data.actualTime,
          clearPercent: data.clearPercent,
          thoughtCount: data.thoughtCount,
          mindStateLog: data.mindStateLog,
          sessionDate: getLocalIsoDate(),
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

    setView("home");
  }, []);

  const navItems: View[] = ["home", "history", "journal", "board", "friends", "settings"];

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
      gridTemplateRows:
        view === "session" || (view === "buddy" && buddySessionId)
          ? "1fr"
          : "auto 1fr auto",
      alignItems: "center",
      fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
      padding: isMobile
        ? "var(--s4) var(--s3) calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))"
        : "var(--s4) var(--s4)",
    }}>
      {/* Nav */}
      {view !== "session" && !(view === "buddy" && buddySessionId) && (
        <div style={isMobile ? {
          position: "fixed", bottom: 0, left: 0, right: 0,
          display: "flex", justifyContent: "space-around",
          background: "rgba(var(--bg-rgb), 0.92)", backdropFilter: "blur(10px)",
          borderTop: "1px solid var(--border-1)",
          padding: "10px 0 env(safe-area-inset-bottom, 8px)",
          zIndex: 100,
        } : {
          position: "fixed", top: "var(--s4)", right: "var(--s4)",
          display: "flex", gap: "var(--s3)",
          zIndex: 100,
        }}>
          {navItems.map(v => (
            <button
              type="button"
              key={v}
              onClick={() => setView(v)}
              style={{
                background: "none", border: "none",
                color: view === v ? "var(--fg)" : "var(--fg-2)",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: isMobile ? "13px" : "11px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                cursor: "pointer",
                padding: isMobile ? "12px 14px" : "8px",
                minWidth: isMobile ? "44px" : undefined,
                minHeight: isMobile ? "44px" : undefined,
                lineHeight: 1.2,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                transition: "color 0.3s",
                position: "relative",
              }}
            >
              {v}
              {view === v && isMobile && (
                <span style={{
                  position: "absolute", bottom: "4px", left: "50%", transform: "translateX(-50%)",
                  width: "16px", height: "2px", borderRadius: "1px",
                  background: "var(--fg)",
                }} />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Welcome header */}
      {view !== "session" && !(view === "buddy" && buddySessionId) && (
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

      {buddyInviteError && view !== "session" && (
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

      {/* Views */}
      {view === "home" && (
        <HomeView
          currentDay={user.currentDay}
          onBegin={handleBegin}
          onBuddy={() => {
            setBuddySessionId(null);
            setBuddyCalendarMessage(null);
            setBuddyInviteError(null);
            setView("buddy");
          }}
        />
      )}

      {view === "buddy" && !buddySessionId && (
        <BuddySessionHub
          onEnterSession={(id, calendarSync) => {
            setBuddyCalendarMessage(calendarSyncMessageFromResult(calendarSync ?? undefined));
            setBuddySessionId(id);
          }}
          onBack={handleBuddyExit}
        />
      )}

      {view === "buddy" && buddySessionId && (
        <BuddySessionRoom
          sessionId={buddySessionId}
          currentUserId={user.id}
          calendarMessage={buddyCalendarMessage}
          onExit={handleBuddyExit}
          onPersonalRecordComplete={handleBuddyPersonalRecordComplete}
        />
      )}

      {view === "session" && (
        <SessionView
          currentDay={user.currentDay}
          onComplete={handleSessionComplete}
          onAbandon={handleSessionAbandon}
        />
      )}

      {view === "complete" && completionData && (
        <CompletionScreen
          dayNumber={completionData.dayNumber}
          duration={completionData.duration}
          clearPercent={completionData.clearPercent}
          thoughtCount={completionData.thoughtCount}
          thoughts={completionData.thoughts}
          onReturn={() => {
            setView("home");
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
        />
      )}

      {view === "history" && (
        <HistoryView currentDay={user.currentDay} username={user.username} />
      )}

      {view === "journal" && (
        <ThoughtJournal username={user.username} />
      )}

      {view === "board" && (
        <PublicBoard currentUsername={user.username} />
      )}

      {view === "friends" && <FriendsView />}

      {view === "settings" && (
        <SettingsView
          user={user}
          onTogglePublic={(isPublic) => setUser({ ...user, isPublic })}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
