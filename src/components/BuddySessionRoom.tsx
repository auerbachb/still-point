"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type BuddySnapshot } from "@/lib/api";

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

type BuddySessionRoomProps = {
  sessionId: string;
  currentUserId: string;
  onExit: () => void;
};

export function BuddySessionRoom({ sessionId, currentUserId, onExit }: BuddySessionRoomProps) {
  const [snap, setSnap] = useState<BuddySnapshot | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const lastRevision = useRef(-1);
  const [tick, setTick] = useState(0);
  const snapRef = useRef<BuddySnapshot | null>(null);
  snapRef.current = snap;

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
    if (snap?.state !== "active") return;
    const id = window.setInterval(() => setTick((t) => t + 1), 500);
    return () => window.clearInterval(id);
  }, [snap?.state]);

  const remainingLive =
    snap?.state === "active" && snap.startedAt
      ? (() => {
          void tick;
          const s = snapRef.current;
          if (!s?.startedAt) return 0;
          const skew = new Date(s.serverNow).getTime() - Date.now();
          const end =
            new Date(s.startedAt).getTime() + s.durationSeconds * 1000;
          return Math.max(0, Math.ceil((end - (Date.now() + skew)) / 1000));
        })()
      : snap?.remainingSeconds ?? null;

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

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "440px",
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
          <p
            style={{
              textAlign: "center",
              margin: 0,
              fontSize: "13px",
              color: "var(--fg-2)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            }}
          >
            {snap.state === "ready_check"
              ? "Everyone is ready — host can start."
              : "Waiting for everyone to join and mark ready."}
          </p>

          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gap: "var(--s2)",
            }}
          >
            {activeInRoom.map((p) => (
              <li
                key={p.userId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 14px",
                  border: "1px solid var(--border-2)",
                  borderRadius: "8px",
                  background: "var(--surface-1)",
                }}
              >
                <span style={{ color: "var(--fg)" }}>
                  {p.username}
                  {p.isHost ? " · host" : ""}
                </span>
                <span style={{ fontSize: "12px", color: "var(--fg-3)" }}>
                  {p.connected ? "● online" : "○ away"}
                  {p.ready ? " · ready" : ""}
                </span>
              </li>
            ))}
          </ul>

          {me && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "var(--s2)",
                cursor: "pointer",
                fontSize: "15px",
                color: "var(--fg)",
              }}
            >
              <input
                type="checkbox"
                checked={me.ready}
                onChange={(e) => setReady(e.target.checked)}
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

      {snap.state === "active" && remainingLive != null && (
        <>
          <div
            style={{
              textAlign: "center",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "min(64px, 14vw)",
              fontWeight: 200,
              color: "var(--fg)",
              lineHeight: 1.1,
              marginTop: "var(--s2)",
            }}
          >
            {formatSeconds(remainingLive)}
          </div>
          <p
            style={{
              textAlign: "center",
              margin: 0,
              fontSize: "12px",
              color: "var(--fg-3)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            }}
          >
            {snap.durationSeconds}s sit · synced from server
          </p>

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

          <p
            style={{
              fontSize: "12px",
              color: "var(--fg-3)",
              textAlign: "center",
              margin: 0,
            }}
          >
            {snap.isHost
              ? "If you leave, the session ends for everyone."
              : "If you leave, your timer view stops but others continue."}
          </p>

          <button type="button" onClick={leave} style={btnSecondary}>
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
