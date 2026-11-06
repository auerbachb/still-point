"use client";

type ParkedBannerProps = {
  /** #982: the server's answer when it turned this sit down on its first
   *  upload, or null. Nothing renders while it is null. */
  parkedReason: string | null;
};

/**
 * #982: the server turned this sit down for good (#978) on its first upload.
 * It is kept on this device, but no flush will send it, so the completion
 * screen must not read as a sit that uploads on reconnect. Says so, gives the
 * server's reason, and points to History, where its owner can try it again or
 * discard it.
 */
export function ParkedBanner({ parkedReason }: ParkedBannerProps) {
  if (parkedReason === null) return null;

  return (
    <div
      role="status"
      data-testid="completion-parked"
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
        the server did not accept this sit
      </div>
      <div style={{ color: "var(--fg-2)" }}>
        It is saved on this device, but it will not upload on its own, even after
        you reconnect. Open History to try it again or discard it.
      </div>
      <div data-testid="completion-parked-reason" style={{ color: "var(--fg-3)", wordBreak: "break-word" }}>
        Reason: {parkedReason || "no reason given"}
      </div>
    </div>
  );
}
