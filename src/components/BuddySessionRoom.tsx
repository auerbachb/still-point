"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type BuddySnapshot } from "@/lib/api";
import { BUDDY_POLICY_CODES, buddyPolicyUserMessage } from "@/lib/buddyPolicyCodes";
import { useIsMobile } from "@/lib/useIsMobile";
import { BlockTimer } from "./BlockTimer";
import { BuddyVideo } from "./BuddyVideo";
import { ThoughtCapture } from "./ThoughtCapture";
import { loadSoundPrefs, saveSoundPrefs, unlockAudioContext, type SoundPrefs } from "@/lib/audio";
import { computeClearPercentFromLog } from "@/lib/mindStateSession";
import { useMindStateHold } from "@/lib/useMindStateHold";

/** Payload for the shared `/app` completion screen after a buddy sit (#119). */
export type BuddyPersonalRecordPayload = {
  sessionId: string;
  dayNumber: number;
  duration: number;
  clearPercent: number;
  thoughtCount: number;
  thoughts: Array<{ timeInSession: number; text: string }>;
};

type BuddySessionRoomProps = {
  sessionId: string;
  currentUserId: string;
  onExit: () => void;
  /** When set, a finished shared timer saves a personal session row then opens the normal completion flow. */
  onPersonalRecordComplete?: (data: BuddyPersonalRecordPayload) => void;
};

function getLocalIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type BuddyMindState = "clear" | "thinking" | "hyperfocus";
type FinalizeAttemptResult = "started" | "already-saving" | "not-ready";

function formatBuddyActionError(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    return buddyPolicyUserMessage(e.code) ?? e.message;
  }
  return e instanceof Error ? e.message : fallback;
}

function BuddyRoomErrorBanner({ message }: { message: string }) {
  return (
    <p
      role="alert"
      style={{
        margin: "0 0 var(--s3)",
        fontSize: "12px",
        color: "var(--fg-2)",
        textAlign: "center",
        lineHeight: 1.45,
      }}
    >
      {message}
    </p>
  );
}

export function BuddySessionRoom({
  sessionId,
  currentUserId,
  onExit,
  onPersonalRecordComplete,
}: BuddySessionRoomProps) {
  const isMobile = useIsMobile();
  const [snap, setSnap] = useState<BuddySnapshot | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [pollStopped, setPollStopped] = useState(false);
  const lastRevision = useRef(-1);
  const [mindState, setMindState] = useState<BuddyMindState>("clear");
  const mindStateRef = useRef<BuddyMindState>(mindState);
  mindStateRef.current = mindState;
  const [mindStateLog, setMindStateLog] = useState<Array<{ time: number; state: string }>>([]);
  const [showPostDistractionCapture, setShowPostDistractionCapture] = useState(false);
  const [sessionThoughts, setSessionThoughts] = useState<Array<{ timeInSession: number; text: string }>>(
    [],
  );
  const [distractionSegmentCount, setDistractionSegmentCount] = useState(0);
  const [soundPrefs, setSoundPrefs] = useState<SoundPrefs>(() => loadSoundPrefs());
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const elapsedRef = useRef(0);
  const [displayElapsed, setDisplayElapsed] = useState(0);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timerAnchorRef = useRef<string | null>(null);
  const [personalRecordError, setPersonalRecordError] = useState<string | null>(null);
  const [dailyMeetingToken, setDailyMeetingToken] = useState<string | null>(null);
  const [dailyTokenError, setDailyTokenError] = useState<string | null>(null);
  const serverFinalizeTriggeredRef = useRef(false);
  const localTimerFinalizeTriggeredRef = useRef(false);
  const pollStoppedFinalizeTriggeredRef = useRef(false);
  const saveInFlightRef = useRef(false);
  const [isSavingPersonalRecord, setIsSavingPersonalRecord] = useState(false);
  const [localTimerCompleted, setLocalTimerCompleted] = useState(false);
  const localTimerCompletedRef = useRef(false);
  const snapRef = useRef(snap);
  const mindStateLogRef = useRef(mindStateLog);
  const sessionThoughtsRef = useRef(sessionThoughts);
  snapRef.current = snap;
  sessionThoughtsRef.current = sessionThoughts;

  const finalizeActiveBuddyHold = useCallback((atTime: number) => {
    const ms = mindStateRef.current;
    if (ms !== "thinking" && ms !== "hyperfocus") return;
    setMindState("clear");
    mindStateRef.current = "clear";
    setMindStateLog((prev) => {
      const next = [...prev, { time: atTime, state: "clear" }];
      mindStateLogRef.current = next;
      return next;
    });
  }, []);

  const beginBuddyDistraction = useCallback(() => {
    if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    setMindState("thinking");
    mindStateRef.current = "thinking";
    setMindStateLog((prev) => {
      const next = [...prev, { time: elapsedRef.current, state: "thinking" }];
      mindStateLogRef.current = next;
      return next;
    });
    setDistractionSegmentCount((c) => c + 1);
  }, [showPostDistractionCapture]);

  const beginBuddyHyperfocus = useCallback(() => {
    if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
    setMindState("hyperfocus");
    mindStateRef.current = "hyperfocus";
    setMindStateLog((prev) => {
      const next = [...prev, { time: elapsedRef.current, state: "hyperfocus" }];
      mindStateLogRef.current = next;
      return next;
    });
  }, [showPostDistractionCapture]);

  const endBuddyHoldFromKeyboard = useCallback(() => {
    finalizeActiveBuddyHold(elapsedRef.current);
  }, [finalizeActiveBuddyHold]);

  const buddyHoldActive = snap?.state === "active";

  const { holdKindRef, resetHoldTracking } = useMindStateHold({
    enabled: buddyHoldActive,
    beginDistraction: beginBuddyDistraction,
    beginHyperfocus: beginBuddyHyperfocus,
    endHoldFromKeyboard: endBuddyHoldFromKeyboard,
  });

  const poll = useCallback(async () => {
    if (pollStopped) return;
    try {
      const { snapshot } = await api.getBuddySnapshot(sessionId);
      if (snapshot.revision < lastRevision.current) return;
      lastRevision.current = snapshot.revision;
      setSnap(snapshot);
      setPollError(null);
    } catch (e) {
      if (e instanceof ApiError && e.code === BUDDY_POLICY_CODES.NOT_IN_SESSION) {
        setPollStopped(true);
        setPollError(formatBuddyActionError(e, "Could not refresh session"));
        return;
      }
      setPollError(formatBuddyActionError(e, "Could not refresh session"));
    }
  }, [pollStopped, sessionId]);

  useEffect(() => {
    setSnap(null);
    snapRef.current = null;
    setMindStateLog([]);
    mindStateLogRef.current = [];
    setSessionThoughts([]);
    sessionThoughtsRef.current = [];
    timerAnchorRef.current = null;
    setPollStopped(false);
    lastRevision.current = -1;
    serverFinalizeTriggeredRef.current = false;
    localTimerFinalizeTriggeredRef.current = false;
    pollStoppedFinalizeTriggeredRef.current = false;
    saveInFlightRef.current = false;
    setIsSavingPersonalRecord(false);
    setLocalTimerCompleted(false);
    localTimerCompletedRef.current = false;
    setAudioBlocked(false);
    setPersonalRecordError(null);
    setDailyMeetingToken(null);
    setDailyTokenError(null);
  }, [sessionId]);

  useEffect(() => {
    if (snap?.state !== "active" || !snap.dailyRoomUrl?.trim()) {
      setDailyMeetingToken(null);
      setDailyTokenError(null);
      return;
    }
    let cancelled = false;
    setDailyMeetingToken(null);
    setDailyTokenError(null);
    void api.getBuddyMeetingToken(sessionId).then(
      (r) => {
        if (!cancelled) setDailyMeetingToken(r.token);
      },
      (e) => {
        if (!cancelled) {
          setDailyTokenError(
            e instanceof ApiError ? e.message : "Could not get video token",
          );
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [sessionId, snap?.state, snap?.dailyRoomUrl]);

  useEffect(() => {
    if (pollStopped) return;
    void poll();
    const id = window.setInterval(() => void poll(), 1500);
    return () => window.clearInterval(id);
  }, [poll, pollStopped]);

  useEffect(() => {
    if (snap?.state !== "active" || !snap.startedAt) return;
    const anchor = `${sessionId}:${snap.startedAt}`;
    if (timerAnchorRef.current === anchor) return;
    timerAnchorRef.current = anchor;
    setMindState("clear");
    setMindStateLog([]);
    setShowPostDistractionCapture(false);
    resetHoldTracking();
    setSessionThoughts([]);
    setDistractionSegmentCount(0);
    setLocalTimerCompleted(false);
    localTimerCompletedRef.current = false;
    setPersonalRecordError(null);
    serverFinalizeTriggeredRef.current = false;
    localTimerFinalizeTriggeredRef.current = false;
    pollStoppedFinalizeTriggeredRef.current = false;
  }, [sessionId, snap?.state, snap?.startedAt, resetHoldTracking]);

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
    setDisplayElapsed(elapsed);
  }, []);

  const handleSoundPlaybackBlocked = useCallback(() => {
    setAudioBlocked(true);
  }, []);

  const handleSoundPrefToggle = useCallback(
    async (key: keyof SoundPrefs) => {
      const next = { ...soundPrefs, [key]: !soundPrefs[key] };
      if (next[key]) {
        const unlockResult = await unlockAudioContext();
        setAudioBlocked(unlockResult === "blocked");
      } else {
        setAudioBlocked(false);
      }
      setSoundPrefs(next);
      saveSoundPrefs(next);
    },
    [soundPrefs],
  );

  const handleEnableLocalAudio = useCallback(async () => {
    const unlockResult = await unlockAudioContext();
    setAudioBlocked(unlockResult === "blocked");
  }, []);

  const buddyAwarenessPct = useMemo(() => {
    if (!snap?.startedAt || snap.state !== "active") return 100;
    const cap = Math.max(snap.durationSeconds, 1);
    const endT = Math.min(cap, displayElapsed);
    return computeClearPercentFromLog(mindStateLog, endT);
  }, [snap?.startedAt, snap?.state, snap?.durationSeconds, displayElapsed, mindStateLog]);

  const handleSaveThought = (text: string) => {
    setSessionThoughts((prev) => [...prev, { timeInSession: Math.round(elapsedRef.current), text }]);
    setShowPostDistractionCapture(false);
  };

  const handleDismissPostCapture = () => {
    setShowPostDistractionCapture(false);
  };

  const openThoughtCapture = () => {
    finalizeActiveBuddyHold(elapsedRef.current);
    setShowPostDistractionCapture(true);
  };

  const closeOpenBuddyHold = useCallback(() => {
    if (mindStateRef.current !== "thinking" && mindStateRef.current !== "hyperfocus") return;
    const duration = snapRef.current?.durationSeconds;
    const at =
      duration && duration > 0 ? Math.min(duration, elapsedRef.current) : elapsedRef.current;
    setMindState("clear");
    mindStateRef.current = "clear";
    setMindStateLog((prev) => {
      const next = [...prev, { time: at, state: "clear" }];
      mindStateLogRef.current = next;
      return next;
    });
    setShowPostDistractionCapture(false);
    resetHoldTracking();
  }, [resetHoldTracking]);

  const handleBuddyTimerComplete = useCallback(() => {
    setLocalTimerCompleted(true);
    localTimerCompletedRef.current = true;
    closeOpenBuddyHold();
    void poll();
  }, [poll, closeOpenBuddyHold]);

  const setReady = async (ready: boolean) => {
    try {
      await api.setBuddyReady(sessionId, ready);
      await poll();
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not update ready"));
    }
  };

  const start = async () => {
    try {
      await api.startBuddySession(sessionId);
      await poll();
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not start"));
    }
  };

  const cancel = async () => {
    try {
      await api.cancelBuddySession(sessionId);
      await poll();
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not cancel"));
    }
  };

  const leave = async (opts?: { ignoreLeaveApiErrors?: boolean }) => {
    const ignoreLeaveApiErrors = opts?.ignoreLeaveApiErrors !== false;
    try {
      await api.leaveBuddySession(sessionId);
      onExit();
    } catch (err) {
      if (ignoreLeaveApiErrors) {
        onExit();
        return;
      }
      throw err;
    }
  };

  const finalizePersonalSession = useCallback(async (): Promise<FinalizeAttemptResult> => {
    if (!onPersonalRecordComplete) return "not-ready";
    if (saveInFlightRef.current) return "already-saving";
    const snapNow = snapRef.current;
    if (!snapNow) return "not-ready";
    if (snapNow.state !== "completed" && !localTimerCompletedRef.current) return "not-ready";

    saveInFlightRef.current = true;
    setIsSavingPersonalRecord(true);
    setPersonalRecordError(null);
    try {
      const durationSeconds = Math.max(
        1,
        snapNow.durationSeconds || Math.round(elapsedRef.current),
      );
      const clearPercent = computeClearPercentFromLog(mindStateLogRef.current, durationSeconds);
      const thoughtsSnapshot = sessionThoughtsRef.current;
      const { session } = await api.recordBuddyPersonalSession(sessionId, {
        clearPercent,
        thoughtCount: thoughtsSnapshot.length,
        mindStateLog: mindStateLogRef.current,
        actualTime: durationSeconds,
        sessionDate: getLocalIsoDate(),
        thoughts: thoughtsSnapshot,
      });
      try {
        await api.leaveBuddySession(sessionId);
      } catch (leaveErr) {
        console.error("Buddy leave after personal record:", leaveErr);
      }
      onPersonalRecordComplete({
        sessionId: session.id,
        dayNumber: session.dayNumber,
        duration: session.duration,
        clearPercent: session.clearPercent,
        thoughtCount: session.thoughtCount,
        thoughts: thoughtsSnapshot,
      });
    } catch (e) {
      setPersonalRecordError(formatBuddyActionError(e, "Could not save your session"));
    } finally {
      saveInFlightRef.current = false;
      setIsSavingPersonalRecord(false);
    }
    return "started";
  }, [sessionId, onPersonalRecordComplete]);

  useEffect(() => {
    if (snap?.state !== "completed" || !onPersonalRecordComplete) return;
    if (serverFinalizeTriggeredRef.current) return;
    void finalizePersonalSession().then((result) => {
      if (result !== "not-ready") {
        serverFinalizeTriggeredRef.current = true;
      }
    });
  }, [snap?.state, sessionId, onPersonalRecordComplete, finalizePersonalSession]);

  useEffect(() => {
    if (!localTimerCompleted || !onPersonalRecordComplete) return;
    if (localTimerFinalizeTriggeredRef.current) return;
    void finalizePersonalSession().then((result) => {
      if (result !== "not-ready") {
        localTimerFinalizeTriggeredRef.current = true;
      }
    });
  }, [localTimerCompleted, onPersonalRecordComplete, finalizePersonalSession]);

  useEffect(() => {
    if (!pollStopped || !localTimerCompleted || !onPersonalRecordComplete) return;
    if (pollStoppedFinalizeTriggeredRef.current) return;
    void finalizePersonalSession().then((result) => {
      if (result !== "not-ready") {
        pollStoppedFinalizeTriggeredRef.current = true;
      }
    });
  }, [pollStopped, localTimerCompleted, onPersonalRecordComplete, finalizePersonalSession]);

  const completeAndExitLegacy = async () => {
    try {
      await api.buddyParticipantComplete(sessionId);
      await leave({ ignoreLeaveApiErrors: false });
    } catch (e) {
      setPollError(formatBuddyActionError(e, "Could not finish session step"));
    }
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
        {pollError ? <BuddyRoomErrorBanner message={pollError} /> : null}
        <EndPanel
          title="Session ended"
          body="The host left or cancelled. You can return home or join again if you still have the link."
          primary={{ label: "Return home", onClick: () => void leave() }}
        />
      </div>
    );
  }

  if (snap.state === "completed") {
    if (!onPersonalRecordComplete) {
      return (
        <div style={{ maxWidth: "440px", margin: "0 auto", width: "100%" }}>
          {pollError ? <BuddyRoomErrorBanner message={pollError} /> : null}
          <EndPanel
            title="Time is complete"
            body="The shared timer has finished. Sign in on the latest app to save this sit to your personal history."
            primary={{ label: "Done", onClick: () => void completeAndExitLegacy() }}
          />
        </div>
      );
    }

    return (
      <div style={{ maxWidth: "440px", margin: "0 auto", width: "100%" }}>
        {pollError ? <BuddyRoomErrorBanner message={pollError} /> : null}
        <div
          style={{
            textAlign: "center",
            display: "grid",
            gap: "var(--s3)",
            padding: "var(--s4) 0",
          }}
        >
          <h3 style={{ margin: 0, fontWeight: 400, fontSize: "20px", color: "var(--fg)" }}>
            Time is complete
          </h3>
          {personalRecordError ? (
            <>
              <BuddyRoomErrorBanner message={personalRecordError} />
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
                <button
                  type="button"
                  onClick={() => void finalizePersonalSession()}
                  disabled={isSavingPersonalRecord}
                  style={{
                    ...btnPrimary,
                    opacity: isSavingPersonalRecord ? 0.65 : 1,
                    cursor: isSavingPersonalRecord ? "not-allowed" : "pointer",
                  }}
                >
                  {isSavingPersonalRecord ? "Trying again..." : "Try again"}
                </button>
                <button type="button" onClick={() => void leave()} style={btnSecondary}>
                  Return home without saving
                </button>
              </div>
            </>
          ) : (
            <p style={{ margin: 0, color: "var(--fg-2)", lineHeight: 1.5, fontSize: "14px" }}>
              {isSavingPersonalRecord
                ? "Saving your personal session..."
                : "Finalizing your personal session..."}
            </p>
          )}
        </div>
      </div>
    );
  }

  const me = snap.participants.find((p) => p.userId === currentUserId);
  const inLobby = snap.state === "waiting" || snap.state === "ready_check";
  const activeInRoom = snap.participants.filter((p) => p.leftAt == null);

  const lobbyReady = snap.state === "ready_check";

  const shellMaxWidth =
    snap.state === "active" && !isMobile
      ? "min(1120px, 100%)"
      : "560px";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: shellMaxWidth,
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

          {!snap.isHost && (
            <p
              role="note"
              style={{
                margin: 0,
                fontSize: "12px",
                color: "var(--fg-3)",
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Only the host can start or cancel the shared session. Your ready toggle is just for you.
            </p>
          )}

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
                title={
                  snap.state !== "ready_check"
                    ? "Everyone must join and mark ready before you can start the shared timer for all."
                    : "Starts the same timer for everyone in the room."
                }
                style={{
                  ...btnPrimary,
                  opacity: snap.state !== "ready_check" ? 0.45 : 1,
                  cursor: snap.state !== "ready_check" ? "not-allowed" : "pointer",
                }}
              >
                Start for everyone
              </button>
              {snap.state !== "ready_check" && (
                <p
                  role="note"
                  style={{
                    margin: 0,
                    fontSize: "12px",
                    color: "var(--fg-3)",
                    textAlign: "center",
                    lineHeight: 1.45,
                  }}
                >
                  Start is a shared action for the host only. It unlocks when everyone has joined and
                  marked ready.
                </p>
              )}
              <button
                type="button"
                onClick={cancel}
                style={btnSecondary}
                title="Ends the invite for everyone. Only the host can cancel before the sit starts."
              >
                Cancel session
              </button>
            </div>
          )}

          <button type="button" onClick={() => void leave()} style={btnGhost}>
            Leave
          </button>
        </>
      )}

      {snap.state === "active" && snap.startedAt && (
        <>
          <div
            style={
              isMobile
                ? {
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--s4)",
                    width: "100%",
                  }
                : {
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) minmax(260px, min(36vw, 380px))",
                    gap: "var(--s4)",
                    alignItems: "start",
                    width: "100%",
                  }
            }
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--s4)",
                minWidth: 0,
                order: isMobile ? 1 : undefined,
              }}
            >
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
                onSoundPlaybackBlocked={handleSoundPlaybackBlocked}
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
                {snap.durationSeconds}s sit · shared timer synced from server · sounds stay local
              </p>
            </div>

            <div
              style={{
                width: "100%",
                order: isMobile ? 2 : undefined,
                ...(isMobile
                  ? {}
                  : { position: "sticky", top: "var(--s4)", alignSelf: "start" }),
              }}
            >
              {snap.dailyRoomUrl ? (
                dailyTokenError ? (
                  <p
                    role="alert"
                    style={{
                      margin: 0,
                      padding: "var(--s4)",
                      textAlign: "center",
                      fontSize: "13px",
                      color: "var(--fg-2)",
                      lineHeight: 1.5,
                      borderRadius: "12px",
                      border: "1px solid var(--border-2)",
                      background: "var(--surface-1)",
                    }}
                  >
                    {dailyTokenError}
                  </p>
                ) : dailyMeetingToken ? (
                  <BuddyVideo
                    roomUrl={snap.dailyRoomUrl}
                    meetingToken={dailyMeetingToken}
                    displayName={me?.username ?? "Participant"}
                  />
                ) : (
                  <p
                    role="status"
                    style={{
                      margin: 0,
                      padding: "var(--s4)",
                      textAlign: "center",
                      fontSize: "13px",
                      color: "var(--fg-2)",
                      lineHeight: 1.5,
                      borderRadius: "12px",
                      border: "1px solid var(--border-2)",
                      background: "var(--surface-1)",
                    }}
                  >
                    Preparing video…
                  </p>
                )
              ) : (
                <p
                  role="status"
                  style={{
                    margin: 0,
                    padding: "var(--s4)",
                    textAlign: "center",
                    fontSize: "13px",
                    color: "var(--fg-2)",
                    lineHeight: 1.5,
                    borderRadius: "12px",
                    border: "1px solid var(--border-2)",
                    background: "var(--surface-1)",
                  }}
                >
                  Video is not available for this session (server did not return a room link).
                </p>
              )}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "var(--s4)",
                minWidth: 0,
                order: isMobile ? 3 : undefined,
                gridColumn: isMobile ? undefined : "1 / -1",
              }}
            >
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
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
                  width: "100%",
                  maxWidth: "min(420px, calc(100vw - 40px))",
                  margin: "0 auto",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    marginTop: "8px",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "11px",
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "var(--fg-3)",
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      width: "10px",
                      height: "10px",
                      borderRadius: "50%",
                      background:
                        mindState === "thinking"
                          ? "var(--accent-amber)"
                          : mindState === "hyperfocus"
                            ? "rgba(96, 165, 250, 0.95)"
                            : "var(--accent-green)",
                      boxShadow:
                        mindState === "thinking"
                          ? "0 0 12px var(--accent-amber)"
                          : mindState === "hyperfocus"
                            ? "0 0 12px rgba(59, 130, 246, 0.6)"
                            : "none",
                      flexShrink: 0,
                    }}
                  />
                  <span>
                    {mindState === "thinking"
                      ? "Distracted"
                      : mindState === "hyperfocus"
                        ? "Hyperfocus"
                        : "Aware"}
                  </span>
                  {distractionSegmentCount > 0 && (
                    <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
                      · {distractionSegmentCount} light{" "}
                      {distractionSegmentCount === 1 ? "segment" : "segments"}
                    </span>
                  )}
                  {sessionThoughts.length > 0 && (
                    <span style={{ color: "var(--accent-amber-border)", marginLeft: "4px" }}>
                      · {sessionThoughts.length} captured {sessionThoughts.length === 1 ? "note" : "notes"}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    justifyContent: "center",
                    gap: "12px",
                    marginTop: "12px",
                    width: "100%",
                  }}
                >
                  <button
                    type="button"
                    aria-pressed={mindState === "thinking"}
                    aria-label="Hold for light distraction, or hold Space. Only on your device."
                    title="Mind-state and thoughts stay on this device; others are not notified."
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
                      holdKindRef.current = "pointerHold";
                      beginBuddyDistraction();
                    }}
                    onMouseUp={() => {
                      if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") {
                        return;
                      }
                      holdKindRef.current = "none";
                      finalizeActiveBuddyHold(elapsedRef.current);
                    }}
                    onMouseLeave={() => {
                      if (holdKindRef.current === "pointerHold" && mindStateRef.current === "thinking") {
                        holdKindRef.current = "none";
                        finalizeActiveBuddyHold(elapsedRef.current);
                      }
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
                      holdKindRef.current = "pointerHold";
                      beginBuddyDistraction();
                    }}
                    onTouchEnd={() => {
                      if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") {
                        return;
                      }
                      holdKindRef.current = "none";
                      finalizeActiveBuddyHold(elapsedRef.current);
                    }}
                    onTouchCancel={() => {
                      if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "thinking") {
                        return;
                      }
                      holdKindRef.current = "none";
                      finalizeActiveBuddyHold(elapsedRef.current);
                    }}
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
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      padding: "12px 16px",
                      borderRadius: "16px",
                      cursor: "pointer",
                      transition: "all 0.25s",
                      flex: "1 1 140px",
                      minWidth: "min(160px, 42vw)",
                      maxWidth: "200px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>{mindState === "thinking" ? "Release" : "Hold"} — light distraction</span>
                    <span
                      style={{
                        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                        fontSize: "9px",
                        letterSpacing: "0.14em",
                        opacity: 0.85,
                        textTransform: "none",
                      }}
                    >
                      or hold Space
                    </span>
                  </button>

                  <button
                    type="button"
                    aria-pressed={mindState === "hyperfocus"}
                    aria-label="Hold for hyperfocus, or hold Comma. Only on your device."
                    title="Mind-state and thoughts stay on this device; others are not notified."
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
                      holdKindRef.current = "pointerHold";
                      beginBuddyHyperfocus();
                    }}
                    onMouseUp={() => {
                      if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") {
                        return;
                      }
                      holdKindRef.current = "none";
                      finalizeActiveBuddyHold(elapsedRef.current);
                    }}
                    onMouseLeave={() => {
                      if (holdKindRef.current === "pointerHold" && mindStateRef.current === "hyperfocus") {
                        holdKindRef.current = "none";
                        finalizeActiveBuddyHold(elapsedRef.current);
                      }
                    }}
                    onTouchStart={(e) => {
                      e.preventDefault();
                      if (mindStateRef.current !== "clear" || showPostDistractionCapture) return;
                      holdKindRef.current = "pointerHold";
                      beginBuddyHyperfocus();
                    }}
                    onTouchEnd={() => {
                      if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") {
                        return;
                      }
                      holdKindRef.current = "none";
                      finalizeActiveBuddyHold(elapsedRef.current);
                    }}
                    onTouchCancel={() => {
                      if (holdKindRef.current !== "pointerHold" || mindStateRef.current !== "hyperfocus") {
                        return;
                      }
                      holdKindRef.current = "none";
                      finalizeActiveBuddyHold(elapsedRef.current);
                    }}
                    style={{
                      background:
                        mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.12)" : "var(--surface-1)",
                      border: `1px solid ${
                        mindState === "hyperfocus" ? "rgba(59, 130, 246, 0.55)" : "var(--border-2)"
                      }`,
                      color:
                        mindState === "hyperfocus" ? "rgba(147, 197, 253, 0.95)" : "var(--fg-2)",
                      fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                      fontSize: "12px",
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      padding: "12px 16px",
                      borderRadius: "16px",
                      cursor: "pointer",
                      transition: "all 0.25s",
                      flex: "1 1 140px",
                      minWidth: "min(160px, 42vw)",
                      maxWidth: "200px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span>{mindState === "hyperfocus" ? "Release" : "Hold"} — hyperfocus</span>
                    <span
                      style={{
                        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                        fontSize: "9px",
                        letterSpacing: "0.14em",
                        opacity: 0.85,
                        textTransform: "none",
                      }}
                    >
                      or hold ,
                    </span>
                  </button>
                </div>

                <p
                  style={{
                    margin: "12px 0 0",
                    textAlign: "center",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "10px",
                    color: "var(--fg-4)",
                    letterSpacing: "0.05em",
                    lineHeight: 1.45,
                  }}
                >
                  Shortcuts when not typing — only on your device. Light distraction holds only log segments;
                  captured notes require an explicit capture path.
                </p>

                <div
                  style={{
                    marginTop: "12px",
                    fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                    fontSize: "10px",
                    color: "var(--fg-4)",
                    letterSpacing: "0.08em",
                    textAlign: "center",
                  }}
                >
                  <span style={{ color: "var(--accent-green-dim)" }}>{buddyAwarenessPct}% awareness</span>
                  <span style={{ margin: "0 6px", color: "var(--fg-4)" }}>·</span>
                  <span style={{ color: "var(--accent-amber-border)" }}>
                    {Math.max(0, 100 - buddyAwarenessPct)}% distraction
                  </span>
                </div>

                {showPostDistractionCapture && (
                  <div
                    data-no-space-distraction
                    style={{ marginTop: "16px", width: "100%", display: "flex", justifyContent: "center" }}
                  >
                    <ThoughtCapture onSave={handleSaveThought} onCancel={handleDismissPostCapture} />
                  </div>
                )}
              </div>

              <div
                style={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "8px",
                    marginTop: "24px",
                  }}
                >
                  <div
                    style={{
                      opacity: controlsVisible ? 1 : 0,
                      transition: "opacity 0.5s ease",
                      pointerEvents: controlsVisible ? "auto" : "none",
                    }}
                  >
                    <button
                      type="button"
                      onClick={openThoughtCapture}
                      style={{
                        border: "1px solid var(--accent-amber-border)",
                        background: "none",
                        color: "var(--accent-amber-border)",
                        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                        fontSize: "11px",
                        letterSpacing: "0.15em",
                        textTransform: "uppercase",
                        padding: "10px 24px",
                        borderRadius: "20px",
                        cursor: "pointer",
                      }}
                    >
                      capture note
                    </button>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "11px",
                      color: "var(--fg-4)",
                      fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                      letterSpacing: "0.06em",
                      textAlign: "center",
                    }}
                  >
                    The timer is shared. Tick, chime, and end sounds are local to this device.
                  </p>
                  {audioBlocked && (
                    <p
                      role="alert"
                      style={{
                        margin: 0,
                        maxWidth: "340px",
                        fontSize: "11px",
                        color: "var(--accent-amber)",
                        fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                        letterSpacing: "0.04em",
                        textAlign: "center",
                        lineHeight: 1.45,
                      }}
                    >
                      Browser audio is paused.
                      <button
                        type="button"
                        onClick={() => void handleEnableLocalAudio()}
                        style={inlineLinkButton}
                      >
                        Enable local audio
                      </button>
                      on this device.
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: "16px",
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
                        aria-pressed={soundPrefs[key]}
                        aria-label={`${label} sound ${soundPrefs[key] ? "on" : "off"}; only you hear this`}
                        title="Only you hear this — does not change audio for others"
                        onClick={() => void handleSoundPrefToggle(key)}
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
              </div>

              <p
                style={{
                  fontSize: "12px",
                  color: "var(--fg-3)",
                  textAlign: "center",
                  margin: 0,
                  lineHeight: 1.45,
                }}
              >
                {snap.isHost
                  ? "If you leave, the shared session ends for everyone (only the host can do that)."
                  : "If you leave, only your view stops — the shared timer keeps running for everyone else."}
              </p>
              {sessionThoughts.length > 0 && (
                <p
                  style={{
                    fontSize: "11px",
                    color: "var(--fg-4)",
                    textAlign: "center",
                    margin: 0,
                    lineHeight: 1.45,
                  }}
                >
                  {sessionThoughts.length} thought{sessionThoughts.length === 1 ? "" : "s"} captured on
                  this device — they are saved to your journal when the shared timer ends.
                </p>
              )}

              <button
                type="button"
                onClick={() => void leave()}
                style={{ ...btnSecondary, marginTop: "var(--s1)" }}
              >
                Leave
              </button>
            </div>
          </div>
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

const inlineLinkButton: CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--accent-amber)",
  cursor: "pointer",
  font: "inherit",
  padding: 0,
  textDecoration: "underline",
};

const btnGhost: CSSProperties = {
  ...btnSecondary,
  border: "none",
  color: "var(--fg-3)",
};
