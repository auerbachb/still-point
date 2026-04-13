"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type BuddySnapshot } from "@/lib/api";
import { BlockTimer } from "./BlockTimer";
import { ThoughtCapture } from "./ThoughtCapture";
import { loadSoundPrefs, saveSoundPrefs, type SoundPrefs } from "@/lib/audio";

type BuddySessionRoomProps = {
  sessionId: string;
  currentUserId: string;
  onExit: () => void;
};

export function BuddySessionRoom({ sessionId, currentUserId, onExit }: BuddySessionRoomProps) {
  const [snap, setSnap] = useState<BuddySnapshot | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const lastRevision = useRef(-1);
  const [mindState, setMindState] = useState("clear");
  const [mindStateLog, setMindStateLog] = useState<Array<{ time: number; state: string }>>([]);
  const [showThoughtInput, setShowThoughtInput] = useState(false);
  const [sessionThoughts, setSessionThoughts] = useState<Array<{ timeInSession: number; text: string }>>(
    [],
  );
  const [sessionThoughtCount, setSessionThoughtCount] = useState(0);
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => loadSoundPrefs());
  const [controlsVisible, setControlsVisible] = useState(true);
  const elapsedRef = useRef(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerAnchorRef = useRef<string | null>(null);

  const poll = useCallback(async () => {
    try {
      const { snapshot } = await api.getBuddySnapshot(sessionId);
      if (snapshot.revision < lastRevision.current) return;
      lastRevision.current = snapshot.revision;
      setSnap(snapshot);
      setPollError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) {
        setPollError(
          "You are no longer in this session. You can leave or join again with the link.",
        );
        return;
      }
      setPollError(e instanceof ApiError ? e.message : "Could not refresh session");
    }
  }, [sessionId]);

  useEffect(() => {
    poll();
    const id = window.setInterval(poll, 1500);
    return () => window.clearInterval(id);
  }, [poll]);

  useEffect(() => {
    if (snap?.state !== "active" || !snap.startedAt) return;
    const anchor = `${sessionId}:${snap.startedAt}`;
    if (timerAnchorRef.current === anchor) return;
    timerAnchorRef.current = anchor;
    setMindState("clear");
    setMindStateLog([]);
    setShowThoughtInput(false);
    setSessionThoughts([]);
    setSessionThoughtCount(0);
  }, [sessionId, snap?.state, snap?.startedAt]);

  useEffect(() => {
    const resetTimer = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 1000);
    };
    resetTimer();
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("mousedown", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("touchstart", resetTimer, { passive: true });
    return () => {
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("mousedown", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("touchstart", resetTimer);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  const handleElapsedChange = useCallback((elapsed: number) => {
    elapsedRef.current = elapsed;
  }, []);

  const handleBuddyTimerComplete = useCallback(() => {
    void poll();
  }, [poll]);

  const handleThinkingToggle = () => {
    const now = elapsedRef.current;
    if (mindState === "clear") {
      setMindState("thinking");
      setMindStateLog((prev) => [...prev, { time: now, state: "thinking" }]);
      setSessionThoughtCount((prev) => prev + 1);
      setShowThoughtInput(true);
    } else {
      setMindState("clear");
      setMindStateLog((prev) => [...prev, { time: now, state: "clear" }]);
      setShowThoughtInput(false);
    }
  };

  const handleSaveThought = (text: string) => {
    setSessionThoughts((prev) => [...prev, { timeInSession: Math.round(elapsedRef.current), text }]);
    setMindState("clear");
    setMindStateLog((prev) => [...prev, { time: elapsedRef.current, state: "clear" }]);
    setShowThoughtInput(false);
  };

  const handleSkipThought = () => {
    setMindState("clear");
    setMindStateLog((prev) => [...prev, { time: elapsedRef.current, state: "clear" }]);
    setShowThoughtInput(false);
  };

  const setReady = async (ready: boolean) => {
    try {
      await api.setBuddyReady(sessionId, ready);
      await poll();
    } catch (e) {
      setPollError(e instanceof ApiError ? e.message : "Could not update ready");
    }
  };

  const start = async () => {
    try {
      await api.startBuddySession(sessionId);
      await poll();
    } catch (e) {
      setPollError(e instanceof ApiError ? e.message : "Could not start");
    }
  };

  const cancel = async () => {
    try {
      await api.cancelBuddySession(sessionId);
      await poll();
    } catch (e) {
      setPollError(e instanceof ApiError ? e.message : "Could not cancel");
    }
  };

  const leave = async () => {
    try {
      await api.leaveBuddySession(sessionId);
    } catch {
      /* still exit UI */
    }
    onExit();
  };

  const completeAndExit = async () => {
    try {
      await api.buddyParticipantComplete(sessionId);
    } catch {
      /* #119 will tighten this */
    }
    await leave();
  };

  if (!snap && !pollError) {
    return (
      <div style={{ textAlign: "center", color: "var(--fg-3)", padding: "var(--s6)" }}>
        Loading session…
      </div>
    );
  }

  if (pollError && !snap) {
    return (
      <div
        style={{
          maxWidth: "400px",
          margin: "0 auto",
          textAlign: "center",
          display: "grid",
          gap: "var(--s3)",
        }}
      >
        <p style={{ color: "var(--fg-2)" }}>{pollError}</p>
        <button type="button" onClick={onExit} style={btnSecondary}>
          Back
        </button>
      </div>
    );
  }

  if (!snap) return null;

  if (snap.state === "abandoned") {
    return (
      <div style={{ maxWidth: "440px", margin: "0 auto", width: "100%" }}>
        <EndPanel
          title="Session ended"
          body="The host left or cancelled. You can return home or join again if you still have the link."
          primary={{ label: "Return home", onClick: leave }}
        />
      </div>
    );
  }

  if (snap.state === "completed") {
    return (
      <div style={{ maxWidth: "440px", margin: "0 auto", width: "100%" }}>
        <EndPanel
          title="Time is complete"
          body="The shared timer has finished. Your personal journal step can be added in a future update."
          primary={{ label: "Done", onClick: completeAndExit }}
        />
      </div>
    );
  }

  const me = snap.participants.find((p) => p.userId === currentUserId);
  const inLobby = snap.state === "waiting" || snap.state === "ready_check";
  const activeInRoom = snap.participants.filter((p) => p.leftAt == null);

  const lobbyReady = snap.state === "ready_check";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "560px",
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
        gap: "var(--s4)",
        animation: "fadeIn 0.5s ease",
      }}
    >
      {pollError && (
        <p style={{ margin: 0, fontSize: "12px", color: "var(--fg-2)", textAlign: "center" }}>
          {pollError}
        </p>
      )}

      <h2
        style={{
          fontSize: "22px",
          fontWeight: 300,
          fontStyle: "italic",
          margin: 0,
          color: "var(--fg)",
          textAlign: "center",
        }}
      >
        Shared session
      </h2>

      {inLobby && (
        <>
          <div
            role="status"
            style={{
              textAlign: "center",
              margin: 0,
              padding: "22px 24px",
              borderRadius: "16px",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "clamp(15px, 3.8vw, 18px)",
              lineHeight: 1.45,
              letterSpacing: "0.04em",
              border: lobbyReady
                ? "2px solid var(--accent-green)"
                : "1px solid var(--border-2)",
              background: lobbyReady
                ? "var(--accent-green-bg-subtle)"
                : "var(--surface-1)",
              color: lobbyReady ? "var(--accent-green)" : "var(--fg-2)",
              boxSizing: "border-box",
            }}
          >
            {lobbyReady
              ? "Everyone is ready — host can start."
              : "Waiting for everyone to join and mark ready."}
          </div>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--s3)",
            }}
          >
            {activeInRoom.map((p) => (
              <li
                key={p.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--s3)",
                  padding: "22px 24px",
                  minHeight: "72px",
                  border: "1px solid var(--border-2)",
                  borderRadius: "16px",
                  background: "var(--surface-1)",
                  boxSizing: "border-box",
                }}
              >
                <span
                  style={{
                    color: "var(--fg)",
                    fontSize: "clamp(18px, 4.5vw, 22px)",
                    fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                  }}
                >
                  {p.username}
                  {p.isHost ? " · host" : ""}
                </span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "12px",
                    fontSize: "clamp(14px, 3.5vw, 17px)",
                    color: "var(--fg-2)",
                    fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
                    flexShrink: 0,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: "14px",
                      height: "14px",
                      borderRadius: "50%",
                      background: p.connected ? "var(--accent-green)" : "var(--fg-4)",
                      boxShadow: p.connected
                        ? "0 0 0 3px var(--accent-green-border-subtle)"
                        : "none",
                    }}
                  />
                  <span>
                    {p.connected ? "online" : "away"}
                    {p.ready ? " · ready" : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>

          {me && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "20px",
                cursor: "pointer",
                fontSize: "clamp(19px, 4.5vw, 24px)",
                color: "var(--fg)",
                padding: "20px 24px",
                minHeight: "76px",
                border: `2px solid ${me.ready ? "var(--accent-green)" : "var(--border-2)"}`,
                borderRadius: "16px",
                background: me.ready ? "var(--accent-green-bg-faint)" : "var(--surface-1)",
                boxSizing: "border-box",
              }}
            >
              <input
                type="checkbox"
                checked={me.ready}
                onChange={(e) => setReady(e.target.checked)}
                style={{
                  width: "40px",
                  height: "40px",
                  minWidth: "40px",
                  minHeight: "40px",
                  margin: 0,
                  cursor: "pointer",
                  accentColor: "var(--accent-green)",
                  flexShrink: 0,
                }}
              />
              I&apos;m ready
            </label>
          )}

          {snap.isHost && (
            <div style={{ display: "grid", gap: "var(--s2)" }}>
              <button
                type="button"
                onClick={start}
                disabled={snap.state !== "ready_check"}
                style={{
                  ...btnPrimary,
                  opacity: snap.state !== "ready_check" ? 0.45 : 1,
                  cursor: snap.state !== "ready_check" ? "not-allowed" : "pointer",
                }}
              >
                Start for everyone
              </button>
              <button type="button" onClick={cancel} style={btnSecondary}>
                Cancel session
              </button>
            </div>
          )}

          <button type="button" onClick={leave} style={btnGhost}>
            Leave
          </button>
        </>
      )}

      {snap.state === "active" && snap.startedAt && (
        <>
          <BlockTimer
            key={`${sessionId}-${snap.startedAt}`}
            totalSeconds={snap.durationSeconds}
            syncClock={{
              startedAt: snap.startedAt,
              serverNow: snap.serverNow,
              durationSeconds: snap.durationSeconds,
            }}
            isActive
            mindState={mindState}
            mindStateLog={mindStateLog}
            onElapsedChange={handleElapsedChange}
            soundPrefs={soundPrefs}
            onComplete={handleBuddyTimerComplete}
          />

          <p
            style={{
              textAlign: "center",
              margin: "-12px 0 0",
              fontSize: "11px",
              color: "var(--fg-3)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              letterSpacing: "0.08em",
            }}
          >
            {snap.durationSeconds}s sit · timer synced from server
          </p>

          <ul
            style={{
              listStyle: "none",
              margin: "var(--s3) 0 0",
              padding: 0,
              display: "grid",
              gap: "var(--s1)",
            }}
          >
            {activeInRoom.map((p) => (
              <li
                key={p.userId}
                style={{ fontSize: "13px", color: "var(--fg-2)", textAlign: "center" }}
              >
                {p.username}
                {p.connected ? "" : " (away)"}
              </li>
            ))}
          </ul>

          <div
            style={{
              opacity: controlsVisible ? 1 : 0,
              transition: "opacity 0.5s ease",
              pointerEvents: controlsVisible ? "auto" : "none",
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                marginTop: "24px",
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={handleThinkingToggle}
                style={{
                  background:
                    mindState === "thinking"
                      ? "var(--accent-amber-bg)"
                      : "var(--accent-green-bg-subtle)",
                  border: `1px solid ${
                    mindState === "thinking"
                      ? "var(--accent-amber-border)"
                      : "var(--accent-green-border)"
                  }`,
                  color:
                    mindState === "thinking" ? "var(--accent-amber)" : "var(--accent-green)",
                  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                  fontSize: "12px",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  padding: "12px 28px",
                  borderRadius: "24px",
                  cursor: "pointer",
                  transition: "all 0.3s",
                  minWidth: "160px",
                }}
              >
                {mindState === "thinking" ? "\u25CB clear mind" : "\u2726 I'm thinking"}
              </button>
              {sessionThoughtCount > 0 && (
                <div
                  style={{
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px",
                    color: "var(--accent-amber-border)",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                  }}
                >
                  💭 {sessionThoughtCount}
                </div>
              )}
            </div>

            {showThoughtInput && (
              <div
                style={{
                  marginTop: "20px",
                  width: "100%",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <ThoughtCapture onSave={handleSaveThought} onCancel={handleSkipThought} />
              </div>
            )}

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "16px",
                marginTop: "24px",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px",
                letterSpacing: "0.1em",
                flexWrap: "wrap",
              }}
            >
              {(
                [
                  ["tick", "tick"],
                  ["chime", "chime"],
                  ["completion", "end"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  onClick={() => {
                    const next = { ...soundPrefs, [key]: !soundPrefs[key] };
                    setSoundPrefs(next);
                    saveSoundPrefs(next);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: soundPrefs[key] ? "var(--fg-3)" : "var(--fg-4)",
                    transition: "color 0.3s",
                    padding: "4px 8px",
                  }}
                >
                  {soundPrefs[key] ? "\u266A" : "\u2022"} {label}
                </button>
              ))}
            </div>
          </div>

          <p
            style={{
              fontSize: "12px",
              color: "var(--fg-3)",
              textAlign: "center",
              margin: "var(--s4) 0 0",
            }}
          >
            {snap.isHost
              ? "If you leave, the session ends for everyone."
              : "If you leave, your timer view stops but others continue."}
          </p>
          {sessionThoughts.length > 0 && (
            <p
              style={{
                fontSize: "11px",
                color: "var(--fg-4)",
                textAlign: "center",
                margin: "var(--s2) 0 0",
                lineHeight: 1.45,
              }}
            >
              {sessionThoughts.length} thought{sessionThoughts.length === 1 ? "" : "s"} captured on
              this device (#119 will sync to your journal).
            </p>
          )}

          <button type="button" onClick={leave} style={{ ...btnSecondary, marginTop: "var(--s3)" }}>
            Leave
          </button>
        </>
      )}
    </div>
  );
}

function EndPanel({
  title,
  body,
  primary,
}: {
  title: string;
  body: string;
  primary: { label: string; onClick: () => void };
}) {
  return (
    <div
      style={{
        textAlign: "center",
        display: "grid",
        gap: "var(--s3)",
        padding: "var(--s4) 0",
      }}
    >
      <h3 style={{ margin: 0, fontWeight: 400, fontSize: "20px", color: "var(--fg)" }}>{title}</h3>
      <p style={{ margin: 0, color: "var(--fg-2)", lineHeight: 1.5, fontSize: "14px" }}>{body}</p>
      <button type="button" onClick={primary.onClick} style={btnPrimary}>
        {primary.label}
      </button>
    </div>
  );
}

const btnPrimary: CSSProperties = {
  background: "linear-gradient(180deg, var(--accent-green), var(--accent-green-end))",
  color: "rgb(var(--bg-rgb))",
  border: "none",
  borderRadius: "40px",
  padding: "14px 24px",
  cursor: "pointer",
  fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
  fontSize: "17px",
  fontStyle: "italic",
};

const btnSecondary: CSSProperties = {
  border: "1px solid var(--border-2)",
  background: "transparent",
  color: "var(--fg)",
  padding: "12px 18px",
  borderRadius: "8px",
  cursor: "pointer",
  fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
  fontSize: "11px",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const btnGhost: CSSProperties = {
  ...btnSecondary,
  border: "none",
  color: "var(--fg-3)",
};
