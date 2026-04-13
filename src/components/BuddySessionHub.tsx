"use client";

import { useState } from "react";
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

export function BuddySessionHub({ onEnterSession, onBack }: BuddySessionHubProps) {
  const [joinToken, setJoinToken] = useState("");
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setBusy(true);
    try {
      const { session } = await api.createBuddySession();
      setCreatedPath(session.sharePath);
      setCreatedId(session.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not create session");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    setError(null);
    const t = extractBuddyToken(joinToken);
    if (!t) {
      setError("Paste a join link or token");
      return;
    }
    setBusy(true);
    try {
      const { sessionId } = await api.joinBuddySession(t);
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
        Create a room, share the link, mark ready when you are set, then the host starts one shared timer for everyone.
      </p>

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
            Start shared session
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
