"use client";

export type SaveStatusState = {
  error: boolean;
  saved: boolean;
  saving: boolean;
};

type SaveStatusProps = {
  status: SaveStatusState;
  /** Shown once the value is stored, e.g. "note saved". */
  savedLabel: string;
};

/** The autosave line under a completion-screen field: error, then saved, then saving. */
export function SaveStatus({ status, savedLabel }: SaveStatusProps) {
  if (status.error) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px", color: "var(--accent-danger)",
          letterSpacing: "0.09em",
        }}
      >
        failed to save
      </div>
    );
  }
  if (status.saved) {
    return (
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px", color: "var(--accent-green-dim)",
        letterSpacing: "0.09em",
      }}>
        {savedLabel}
      </div>
    );
  }
  if (status.saving) {
    return (
      <div style={{
        fontFamily: "var(--font-mono)",
        fontSize: "11px", color: "var(--fg-3)",
        letterSpacing: "0.09em",
      }}>
        saving...
      </div>
    );
  }
  return null;
}
