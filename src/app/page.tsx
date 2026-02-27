"use client";

import { useState, useEffect, useCallback } from "react";
import { AuthScreen } from "@/components/AuthScreen";
import { HomeView } from "@/components/HomeView";
import { SessionView } from "@/components/SessionView";
import { CompletionScreen } from "@/components/CompletionScreen";
import { HistoryView } from "@/components/HistoryView";
import { ThoughtJournal } from "@/components/ThoughtJournal";
import { PublicBoard } from "@/components/PublicBoard";
import { SettingsView } from "@/components/SettingsView";
import { useIsMobile } from "@/lib/useIsMobile";

type View = "home" | "session" | "complete" | "history" | "journal" | "board" | "settings";

type User = {
  id: string;
  email: string;
  username: string;
  isPublic: boolean;
  currentDay: number;
};

type CompletionData = {
  sessionId: string | null;
  dayNumber: number;
  duration: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
};

export default function StillPoint() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<View>("home");
  const [authChecked, setAuthChecked] = useState(false);
  const [completionData, setCompletionData] = useState<CompletionData | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    fetch("/api/auth/me")
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.user) {
          setUser(data.user);
        }
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  const handleLogin = (userData: User) => {
    setUser(userData);
    setView("home");
  };

  const handleLogout = () => {
    setUser(null);
    setView("home");
  };

  const handleBegin = () => {
    setView("session");
  };

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
          sessionDate: new Date().toISOString().split("T")[0],
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
          sessionDate: new Date().toISOString().split("T")[0],
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

  const navItems: View[] = ["home", "history", "journal", "board", "settings"];

  // Loading state
  if (!authChecked) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
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

  // Not logged in
  if (!user) {
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column",
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
      minHeight: "100svh",
      display: "grid",
      gridTemplateRows: view === "session" ? "1fr" : "auto 1fr auto",
      alignItems: "center",
      fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
      padding: isMobile
        ? "var(--s4) var(--s3) calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))"
        : "var(--s4) var(--s4)",
    }}>
      {/* Nav */}
      {view !== "session" && (
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
      {view !== "session" && (
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

      {/* Views */}
      {view === "home" && (
        <HomeView currentDay={user.currentDay} onBegin={handleBegin} />
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
          onReturn={() => setView("home")}
          onSaveNote={async (text: string) => {
            if (!completionData.sessionId) throw new Error("Missing session ID");
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
          }}
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
