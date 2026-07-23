"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api";

type DeleteAccountSectionProps = {
  onDeleted: () => void | Promise<void>;
};

export function DeleteAccountSection({ onDeleted }: DeleteAccountSectionProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    setDeleting(true);
    setError(null);

    try {
      await api.deleteAccount();
      await onDeleted();
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Could not delete your account. Please try again.");
      } else {
        setError("Network error while deleting your account. Please retry.");
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      style={{
        padding: "16px 20px",
        background: "var(--surface-1)",
        borderRadius: "10px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        border: "1px solid var(--accent-danger-border-subtle)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          color: "var(--accent-danger)",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        Delete account
      </div>
      <p
        style={{
          margin: 0,
          color: "var(--fg-2)",
          fontSize: "14px",
          lineHeight: 1.5,
        }}
      >
        Permanently remove your account and all associated data. This action cannot be undone.
      </p>

      {error && (
        <div
          role="alert"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            color: "var(--accent-danger)",
          }}
        >
          {error}
        </div>
      )}

      {!confirming ? (
        <button
          type="button"
          data-testid="delete-account-trigger"
          onClick={() => {
            setConfirming(true);
            setError(null);
          }}
          disabled={deleting}
          style={{
            alignSelf: "flex-start",
            background: "none",
            border: "1px solid var(--accent-danger-border-subtle)",
            color: "var(--accent-danger-muted)",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            padding: "10px 12px",
            borderRadius: "8px",
            cursor: deleting ? "wait" : "pointer",
            opacity: deleting ? 0.7 : 1,
          }}
        >
          Delete account
        </button>
      ) : (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="delete-account-confirm"
            onClick={handleDeleteAccount}
            disabled={deleting}
            style={{
              background: "var(--accent-danger-bg)",
              border: "1px solid var(--accent-danger-border-subtle)",
              color: "var(--accent-danger)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "10px 12px",
              borderRadius: "8px",
              cursor: deleting ? "wait" : "pointer",
              opacity: deleting ? 0.7 : 1,
            }}
          >
            {deleting ? "Deleting..." : "Confirm delete"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setError(null);
            }}
            disabled={deleting}
            style={{
              background: "none",
              border: "1px solid var(--border-2)",
              color: "var(--fg-3)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              padding: "10px 12px",
              borderRadius: "8px",
              cursor: deleting ? "not-allowed" : "pointer",
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
