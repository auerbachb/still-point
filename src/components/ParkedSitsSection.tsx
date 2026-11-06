"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatSessionDurationLabel } from "@/lib/historyMonthGrid";
import {
  getWebSessionSyncCoordinator,
  type ParkedRetryResult,
  type ParkedSession,
  type PendingSessionEntry,
  type WebSessionSyncCoordinator,
} from "@/lib/offlineSessionQueue";

type ParkedEntry = PendingSessionEntry & { parked: ParkedSession };

type ParkedSitsCoordinator = Pick<
  WebSessionSyncCoordinator,
  "parkedEntries" | "retryParkedEntry" | "discardParkedEntry"
>;

type ParkedSitsSectionProps = {
  ownerUserId: string;
  /** Runs once a retry gets a sit onto the server, so the caller can re-read
   *  the progression it moved. */
  onSynced?: () => void;
  /** The queue to read and change. Defaults to this tab's shared coordinator. */
  coordinator?: ParkedSitsCoordinator;
};

/** #982: what a retry of a parked sit tells its owner. */
export function parkedRetryMessage(result: ParkedRetryResult): string {
  switch (result.status) {
    case "synced":
      return "Uploaded. The sit is saved to your account.";
    case "pending":
      return "Not uploaded yet. The sit is queued again and uploads once you are online and signed in.";
    case "parked":
      return `The server turned it down again: ${result.parked.message || "no reason given"}`;
    case "gone":
      return "That sit is no longer on this device.";
  }
}

/** #982: the sit's date as the History list shows it. */
function parkedSitDateLabel(entry: ParkedEntry): string {
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(entry.request.sessionDate)
    ? entry.request.sessionDate
    : entry.enqueuedAt.slice(0, 10);
  const date = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

const mono: CSSProperties = { fontFamily: "var(--font-mono)" };

const actionButton: CSSProperties = {
  ...mono,
  background: "none",
  border: "1px solid var(--border-2)",
  color: "var(--fg-2)",
  fontSize: "11px",
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  padding: "8px 12px",
  borderRadius: "8px",
  minHeight: "44px",
  cursor: "pointer",
};

const dangerButton: CSSProperties = {
  ...actionButton,
  border: "1px solid var(--accent-danger-border-subtle)",
  color: "var(--accent-danger)",
};

/**
 * #982: the sits the server turned down for good (#978), kept on this device
 * where no flush sends them. Each shows its date, length and the server's
 * reason, with Try again (one upload; the same answer parks it again) and
 * Discard (after a confirm). Renders nothing while this account has none.
 */
export function ParkedSitsSection({ ownerUserId, onSynced, coordinator }: ParkedSitsSectionProps) {
  // The shared coordinator is a singleton, so this is stable across renders.
  const queue = coordinator ?? getWebSessionSyncCoordinator();

  const [entries, setEntries] = useState<ParkedEntry[]>([]);
  // Per row, so one row's action finishing never re-enables another's buttons.
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const setRowBusy = (clientSessionId: string, busy: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(clientSessionId);
      else next.delete(clientSessionId);
      return next;
    });
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Reads can overlap (mount, an `online` event, an action finishing). Only the
  // latest one is shown, and none once the section has unmounted or the
  // account changed, so a slow early read never brings back a discarded row.
  const latestRead = useRef(0);
  const reload = useCallback(async () => {
    const read = ++latestRead.current;
    try {
      const next = await queue.parkedEntries(ownerUserId);
      if (read === latestRead.current) setEntries(next);
    } catch (error) {
      console.error("Failed to read parked sits:", error);
    }
  }, [queue, ownerUserId]);

  useEffect(() => {
    // A new account never sees the previous one's rows, even if its read fails.
    setEntries([]);
    setStatus(null);
    setConfirmingId(null);
    void reload();
    const onOnline = () => { void reload(); };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      latestRead.current += 1;
    };
  }, [reload]);

  const retry = async (clientSessionId: string) => {
    setRowBusy(clientSessionId, true);
    setConfirmingId(null);
    setStatus(null);
    try {
      const result = await queue.retryParkedEntry(clientSessionId, ownerUserId);
      setStatus(parkedRetryMessage(result));
      // A row that went up before a later part was turned down still moved
      // progression, so the caller re-reads it then too.
      if (
        result.status === "synced" ||
        ((result.status === "parked" || result.status === "pending") && result.sessionUploaded)
      ) onSynced?.();
    } catch (error) {
      console.error("Failed to retry a parked sit:", error);
      setStatus("Could not try it again. Please retry.");
    } finally {
      setRowBusy(clientSessionId, false);
      await reload();
    }
  };

  const discard = async (clientSessionId: string) => {
    setRowBusy(clientSessionId, true);
    setStatus(null);
    try {
      const removed = await queue.discardParkedEntry(clientSessionId, ownerUserId);
      setStatus(removed ? "Discarded." : "That sit is no longer on this device.");
    } catch (error) {
      console.error("Failed to discard a parked sit:", error);
      setStatus("Could not discard it. Please retry.");
    } finally {
      setConfirmingId(null);
      setRowBusy(clientSessionId, false);
      await reload();
    }
  };

  if (entries.length === 0 && status === null) return null;

  return (
    <section
      data-testid="parked-sits"
      aria-label="Sits the server did not accept"
      style={{
        width: "100%", maxWidth: "480px",
        display: "flex", flexDirection: "column", gap: "12px",
        padding: "16px 20px", borderRadius: "10px",
        background: "var(--surface-1)",
        border: "1px solid var(--accent-danger-border-subtle)",
      }}
    >
      <div style={{ ...mono, fontSize: "12px", color: "var(--accent-danger)", letterSpacing: "0.12em", textTransform: "uppercase" }}>
        Not uploaded
      </div>
      {entries.length > 0 && (
        <p style={{ margin: 0, color: "var(--fg-2)", fontSize: "14px", lineHeight: 1.5 }}>
          The server turned down {entries.length === 1 ? "this upload" : "these uploads"}, so what it
          refused is kept only on this device and will not upload on its own.
        </p>
      )}

      <div role="status" aria-live="polite" data-testid="parked-sits-status" style={{ ...mono, fontSize: "11px", color: "var(--fg-2)" }}>
        {status}
      </div>

      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "12px" }}>
        {entries.map((entry) => {
          const busy = busyIds.has(entry.clientSessionId);
          const confirming = confirmingId === entry.clientSessionId;
          return (
            <li
              key={entry.clientSessionId}
              data-testid="parked-sit"
              style={{ display: "flex", flexDirection: "column", gap: "6px", paddingTop: "8px", borderTop: "1px solid var(--border-1)" }}
            >
              <div style={{ ...mono, fontSize: "12px", color: "var(--fg)" }}>
                {parkedSitDateLabel(entry)} · {formatSessionDurationLabel(entry.request.actualTime)}
              </div>
              {entry.sessionSynced && (
                // The row went up; only its thoughts or note were turned down.
                <div data-testid="parked-sit-row-saved" style={{ fontSize: "13px", color: "var(--fg-2)", lineHeight: 1.5 }}>
                  The sit is saved to your account. Only a later change (its thoughts or note) was not
                  accepted; Discard drops just that change from this device.
                </div>
              )}
              <div data-testid="parked-sit-reason" style={{ ...mono, fontSize: "11px", color: "var(--fg-3)", wordBreak: "break-word" }}>
                Reason: {entry.parked.message || "no reason given"}
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {!confirming ? (
                  <>
                    <button
                      type="button"
                      data-testid="parked-sit-retry"
                      disabled={busy}
                      onClick={() => { void retry(entry.clientSessionId); }}
                      style={{ ...actionButton, opacity: busy ? 0.5 : 1, cursor: busy ? "wait" : "pointer" }}
                    >
                      {busy ? "Trying..." : "Try again"}
                    </button>
                    <button
                      type="button"
                      data-testid="parked-sit-discard"
                      disabled={busy}
                      onClick={() => { setConfirmingId(entry.clientSessionId); setStatus(null); }}
                      style={{ ...dangerButton, opacity: busy ? 0.5 : 1 }}
                    >
                      Discard
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      data-testid="parked-sit-discard-confirm"
                      disabled={busy}
                      onClick={() => { void discard(entry.clientSessionId); }}
                      style={{ ...dangerButton, opacity: busy ? 0.5 : 1 }}
                    >
                      {busy ? "Discarding..." : entry.sessionSynced ? "Confirm: discard the change" : "Confirm discard"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirmingId(null)}
                      style={actionButton}
                    >
                      Keep it
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
