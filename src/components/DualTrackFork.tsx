"use client";

import { useState } from "react";
import { MAX_DURATION, BASE_DURATION } from "@/lib/constants";
import { ApiError } from "@/lib/api";

type DualTrackForkProps = {
  /** Opt into the second daily track. Resolves once the server has enabled it. */
  onEnable: () => Promise<void>;
  /** Dismiss the fork for now (stay single-track); may reappear on a later visit. */
  onDismiss: () => void;
};

const MAX_MINUTES = Math.round(MAX_DURATION / 60);
const BASE_MINUTES = Math.round(BASE_DURATION / 60);

/**
 * Dual-track fork choice (#240). Presented on Home once the primary track passes
 * the 10-minute mark. Follows the BuddySessionHub two-path layout: one framed
 * card per path, a primary "add a second track" action and a quieter "keep one
 * track" dismissal, so the choice reads as two clear options rather than a
 * yes/no prompt.
 */
export function DualTrackFork({ onEnable, onDismiss }: DualTrackForkProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleEnable() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await onEnable();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add a second track. Please retry.");
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "var(--s3)",
        width: "100%",
        maxWidth: "min(440px, calc(100vw - 40px))",
        margin: "0 auto",
        border: "1px solid var(--border-2)",
        borderRadius: "16px",
        padding: "var(--s4)",
        background: "var(--surface-1)",
        boxSizing: "border-box",
        animation: "fadeIn 0.6s ease",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            color: "var(--accent-green-text)",
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            marginBottom: "var(--s2)",
          }}
        >
          {MAX_MINUTES}-minute mark reached
        </div>
        <h2
          style={{
            fontSize: "22px",
            fontWeight: 300,
            fontStyle: "italic",
            margin: 0,
            color: "var(--fg)",
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
          }}
        >
          Add a second daily track?
        </h2>
        <p
          style={{
            fontSize: "14px",
            color: "var(--fg-2)",
            lineHeight: 1.5,
            margin: "var(--s2) 0 0",
          }}
        >
          Your sits have grown to {MAX_MINUTES} minutes. Keep that daily sit and start a second
          one that restarts at {BASE_MINUTES} minute and grows +10s a day — two tracks, run
          independently.
        </p>
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
            boxSizing: "border-box",
          }}
        >
          {error}
        </p>
      )}

      {/* Path 1: add the second track (primary action). */}
      <div
        style={{
          width: "100%",
          border: "1px solid var(--accent-green-border)",
          borderRadius: "12px",
          padding: "var(--s3)",
          background: "var(--accent-green-bg-subtle)",
          boxSizing: "border-box",
          display: "grid",
          gap: "var(--s2)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "16px",
            fontStyle: "italic",
            color: "var(--fg)",
          }}
        >
          Two tracks
        </div>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--fg-2)", lineHeight: 1.45 }}>
          Keep your {MAX_MINUTES}-minute sit and add a fresh {BASE_MINUTES}-minute track that ramps
          back up alongside it.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={handleEnable}
          style={{
            marginTop: "var(--s1)",
            background: "transparent",
            border: "1px solid var(--accent-green-border)",
            color: "var(--accent-green-text)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "12px 24px",
            borderRadius: "40px",
            cursor: busy ? "wait" : "pointer",
            width: "100%",
          }}
        >
          {busy ? "Adding…" : "Add second track"}
        </button>
      </div>

      {/* Path 2: keep a single track (dismiss). */}
      <div
        style={{
          width: "100%",
          border: "1px solid var(--border-2)",
          borderRadius: "12px",
          padding: "var(--s3)",
          boxSizing: "border-box",
          display: "grid",
          gap: "var(--s2)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-newsreader), 'Newsreader', Georgia, serif",
            fontSize: "16px",
            fontStyle: "italic",
            color: "var(--fg)",
          }}
        >
          One track
        </div>
        <p style={{ margin: 0, fontSize: "13px", color: "var(--fg-2)", lineHeight: 1.45 }}>
          Stay with a single {MAX_MINUTES}-minute daily sit. You can add a second track later.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={onDismiss}
          style={{
            marginTop: "var(--s1)",
            background: "transparent",
            border: "1px solid var(--border-2)",
            color: "var(--fg-2)",
            fontFamily: "var(--font-jetbrains), 'JetBrains Mono', monospace",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "12px 24px",
            borderRadius: "40px",
            cursor: busy ? "not-allowed" : "pointer",
            width: "100%",
          }}
        >
          Keep one track
        </button>
      </div>
    </div>
  );
}
