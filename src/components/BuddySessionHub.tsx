"use client";

import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";

function extractBuddyToken(input: string): string {
  const t = input.trim();
  try {
    const u = new URL(t);
    const q = u.searchParams.get("buddy");
    if (q) return q.trim();
  } catch {
    /* not an absolute URL */
  }
  if (t.includes("buddy=")) {
    const i = t.indexOf("buddy=");
    const rest = t.slice(i + 6);
    const amp = rest.indexOf("&");
    return (amp === -1 ? rest : rest.slice(0, amp)).trim();
  }
  return t;
}

type BuddySessionHubProps = {
  onEnterSession: (sessionId: string) => void;
  onBack: () => void;
};

type CalendarSync = NonNullable<Awaited<ReturnType<typeof api.joinBuddySession>>["calendarSync"]>;

export function BuddySessionHub({ onEnterSession, onBack }: BuddySessionHubProps) {
  const [joinToken, setJoinToken] = useState("");
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [createdScheduledStartAt, setCreatedScheduledStartAt] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<{
    connected: boolean;
    email: string | null;
  } | null>(null);
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.getGoogleCalendarStatus().then(
      ({ google }) => {
        if (!cancelled) setGoogleStatus(google);
      },
      () => {
        if (!cancelled) setGoogleStatus({ connected: false, email: null });
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  function localDateTimeToIso(value: string): { ok: true; value: string | null } | { ok: false } {
    if (!value.trim()) return { ok: true, value: null };
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      setError("Pick a valid date and time");
      return { ok: false };
    }
    if (date.getTime() <= Date.now()) {
      setError("Pick a future time for a scheduled session");
      return { ok: false };
    }
    return { ok: true, value: date.toISOString() };
  }

  function formatScheduled(value: string | null): string | null {
    if (!value) return null;
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  }

  function calendarSyncMessage(sync: CalendarSync) {
    if (sync.length === 0) return null;
    const item = sync[0];
    if (!item) return null;
    if (item.status === "created") return "Added to your Google Calendar.";
    if (item.status === "skipped") return "Google Calendar is not connected on this account.";
    return "Could not add to Google Calendar, but the invite was created.";
  }

  async function handleCreate() {
    setError(null);
    setCalendarMessage(null);
    const scheduledStartAt = localDateTimeToIso(scheduledLocal);
    if (!scheduledStartAt.ok) return;
    setBusy(true);
    try {
      const { session } = await api.createBuddySession({ scheduledStartAt: scheduledStartAt.value });
      setCreatedPath(session.sharePath);
      setCreatedId(session.id);
      setCreatedScheduledStartAt(session.scheduledStartAt);
      setCalendarMessage(calendarSyncMessage(session.calendarSync));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create session");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setError(null);
    setCalendarMessage(null);
    const t = extractBuddyToken(joinToken);
    if (!t) {
      setError("Paste a join link or token");
      return;
    }
    setBusy(true);
    try {
      const { sessionId, calendarSync } = await api.joinBuddySession(t);
      if (calendarSync) setCalendarMessage(calendarSyncMessage(calendarSync));
      onEnterSession(sessionId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not join");
    } finally {
      setBusy(false);
    }
  }

  async function enterWaitingRoom() {
    if (createdId) onEnterSession(createdId);
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--s4)",
        width: "100%",
        maxWidth: "420px",
        margin: "0 auto",
        animation: "fadeIn 0.6s ease",
      }}
    >
      <h2
        style={{
          fontSize: "24px",
          fontWeight: 300,
          fontStyle: "italic",
          margin: 0,
          color: "var(--fg)",
          textAlign: "center",
        }}
      >
        Meditate with a friend
      </h2>
      <p
        style={{
          fontSize: "14px",
          color: "var(--fg-2)",
          lineHeight: 1.5,
          textAlign: "center",
          margin: 0,
        }}
      >
        Create a room now, or schedule a shared sit and let each connected Google Calendar add the agreed time.
      </p>

      <div
        style={{
          width: "100%",
          border: "1px solid var(--border-2)",
          borderRadius: "12px",
          padding: "14px",
          background: "var(--surface-1)",
          boxSizing: "border-box",
          display: "grid",
          gap: "var(--s2)",
        }}
      >
        <p style={{ margin: 0, fontSize: "13px", color: "var(--fg-2)", lineHeight: 1.45 }}>
          Google Calendar:{" "}
          {googleStatus?.connected
            ? `connected${googleStatus.email ? ` as ${googleStatus.email}` : ""}`
            : "not connected"}
        </p>
        {!googleStatus?.connected && (
          <a
            href="/api/auth/google"
            style={{
              color: "var(--fg)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Connect Google Calendar
          </a>
        )}
        {calendarMessage && (
          <p style={{ margin: 0, fontSize: "12px", color: "var(--fg-3)", lineHeight: 1.45 }}>
            {calendarMessage}
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            fontSize: "13px",
            color: "var(--fg)",
            textAlign: "center",
            border: "1px solid var(--border-2)",
            padding: "10px 14px",
            borderRadius: "8px",
            width: "100%",
          }}
        >
          {error}
        </p>
      )}

      {!createdPath ? (
        <>
          <label
            htmlFor="buddy-scheduled-start"
            style={{
              width: "100%",
              display: "grid",
              gap: "var(--s2)",
              color: "var(--fg-2)",
              fontSize: "13px",
            }}
          >
            Schedule for later (optional)
            <input
              id="buddy-scheduled-start"
              type="datetime-local"
              value={scheduledLocal}
              onChange={(e) => setScheduledLocal(e.target.value)}
              disabled={busy}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "var(--surface-1)",
                border: "1px solid var(--border-2)",
                color: "var(--fg)",
                borderRadius: "8px",
                padding: "10px 12px",
                fontSize: "13px",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={handleCreate}
            style={{
              background: "var(--surface-1)",
              border: "1px solid var(--border-2)",
              color: "var(--fg)",
              fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
              fontSize: "16px",
              fontStyle: "italic",
              padding: "14px 28px",
              borderRadius: "40px",
              cursor: busy ? "wait" : "pointer",
              width: "100%",
            }}
          >
            {scheduledLocal ? "Create scheduled invite" : "Start shared session"}
          </button>

          <div
            style={{
              width: "100%",
              borderTop: "1px solid var(--border-1)",
              paddingTop: "var(--s4)",
            }}
          >
            <label
              htmlFor="buddy-join-token"
              style={{
                display: "block",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "var(--fg-3)",
                marginBottom: "var(--s2)",
              }}
            >
              Join with link or token
            </label>
            <textarea
              id="buddy-join-token"
              value={joinToken}
              onChange={(e) => setJoinToken(e.target.value)}
              placeholder="Paste full URL or token"
              rows={3}
              style={{
                width: "100%",
                boxSizing: "border-box",
                background: "var(--surface-1)",
                border: "1px solid var(--border-2)",
                color: "var(--fg)",
                borderRadius: "8px",
                padding: "10px 12px",
                fontSize: "13px",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                resize: "vertical",
              }}
            />
            <button
              type="button"
              disabled={busy}
              onClick={handleJoin}
              style={{
                marginTop: "var(--s3)",
                width: "100%",
                background: "transparent",
                border: "1px solid var(--border-2)",
                color: "var(--fg)",
                fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
                fontSize: "11px",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                padding: "12px",
                borderRadius: "8px",
                cursor: busy ? "wait" : "pointer",
              }}
            >
              Join session
            </button>
          </div>
        </>
      ) : (
        <div style={{ width: "100%", display: "grid", gap: "var(--s3)" }}>
          <p style={{ margin: 0, fontSize: "14px", color: "var(--fg-2)" }}>
            Share this link with your friend (they must be signed in):
          </p>
          {createdScheduledStartAt && (
            <p style={{ margin: 0, fontSize: "14px", color: "var(--fg-2)", lineHeight: 1.45 }}>
              Scheduled for {formatScheduled(createdScheduledStartAt)}. They accept by joining; Google Calendar sync runs for each connected account.
            </p>
          )}
          <code
            style={{
              display: "block",
              wordBreak: "break-all",
              fontSize: "12px",
              padding: "12px",
              background: "var(--surface-1)",
              border: "1px solid var(--border-2)",
              borderRadius: "8px",
              color: "var(--fg)",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            }}
          >
            {typeof window !== "undefined"
              ? `${window.location.origin}${createdPath}`
              : createdPath}
          </code>
          <button
            type="button"
            onClick={async () => {
              const full =
                typeof window !== "undefined"
                  ? `${window.location.origin}${createdPath}`
                  : createdPath;
              try {
                await navigator.clipboard.writeText(full);
              } catch {
                setError("Could not copy — select the link manually");
              }
            }}
            style={{
              border: "1px solid var(--border-2)",
              background: "transparent",
              color: "var(--fg)",
              padding: "10px",
              borderRadius: "8px",
              cursor: "pointer",
              fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Copy link
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={enterWaitingRoom}
            style={{
              background:
                "linear-gradient(180deg, var(--accent-green), var(--accent-green-end))",
              color: "rgb(var(--bg-rgb))",
              border: "none",
              borderRadius: "40px",
              padding: "14px 24px",
              cursor: "pointer",
              fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
              fontSize: "17px",
              fontStyle: "italic",
            }}
          >
            Enter waiting room
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onBack}
        style={{
          marginTop: "var(--s2)",
          background: "none",
          border: "none",
          color: "var(--fg-3)",
          cursor: "pointer",
          fontSize: "13px",
          textDecoration: "underline",
        }}
      >
        Back to home
      </button>
    </div>
  );
}
