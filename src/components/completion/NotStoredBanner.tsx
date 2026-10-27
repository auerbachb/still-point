"use client";

import { useState } from "react";

type NotStoredBannerProps = {
  /** #703: the sit could not be stored on this device. Nothing renders otherwise. */
  notStored: boolean;
  /** #703: retry the local save. Rejects when the sit still could not be stored. */
  onRetrySave?: () => Promise<void>;
};

/**
 * #703: a refused local write used to render as an ordinary pending-sync
 * completion. It is now said plainly, with the one action that can still
 * recover the sit, because leaving this screen ends it.
 *
 * Always mounted by the completion screen, so the retry state outlives a
 * `notStored` flip the way it did when the screen held it.
 */
export function NotStoredBanner({ notStored, onRetrySave }: NotStoredBannerProps) {
  const [retryingSave, setRetryingSave] = useState(false);
  const [retrySaveFailed, setRetrySaveFailed] = useState(false);

  if (!notStored) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="completion-not-stored"
      style={{
        width: "100%", maxWidth: "min(380px, calc(100vw - 40px))",
        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "8px",
        padding: "12px 16px", borderRadius: "10px",
        border: "1px solid var(--accent-danger-border)",
        background: "var(--surface-1)",
        fontFamily: "var(--font-mono)",
        fontSize: "11px", lineHeight: 1.6, letterSpacing: "0.06em",
        color: "var(--accent-danger)",
      }}
    >
      <div style={{ letterSpacing: "0.12em", textTransform: "uppercase" }}>
        this sit was not saved
      </div>
      <div style={{ color: "var(--fg-2)" }}>
        This device would not store it, so it is not queued and it will not upload
        later. Stay on this screen — leaving loses the sit. Reconnect if you can,
        then retry.
      </div>
      {onRetrySave && (
        <button
          type="button"
          onClick={async () => {
            setRetryingSave(true);
            try {
              setRetrySaveFailed(false);
              await onRetrySave();
            } catch (err) {
              console.error("Failed to retry session save:", err);
              setRetrySaveFailed(true);
            } finally {
              setRetryingSave(false);
            }
          }}
          disabled={retryingSave}
          style={{
            background: "none",
            border: "1px solid var(--accent-danger-border)",
            color: "var(--accent-danger)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px", letterSpacing: "0.12em", textTransform: "uppercase",
            padding: "8px 24px", borderRadius: "20px",
            minHeight: "44px",
            cursor: retryingSave ? "default" : "pointer",
            opacity: retryingSave ? 0.5 : 1,
          }}
        >
          {retryingSave ? "retrying..." : retrySaveFailed ? "still not saved — retry" : "retry save"}
        </button>
      )}
    </div>
  );
}
