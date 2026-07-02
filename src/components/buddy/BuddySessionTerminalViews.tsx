import { BuddySessionEndPanel } from "./BuddySessionEndPanel";
import { BuddySessionRoomErrorBanner } from "./BuddySessionRoomErrorBanner";
import { btnPrimary, btnSecondary } from "./buddySessionRoomStyles";

type BuddySessionAbandonedViewProps = {
  pollError: string | null;
  onLeave: () => void;
};

export function BuddySessionAbandonedView({ pollError, onLeave }: BuddySessionAbandonedViewProps) {
  return (
    <div style={{ maxWidth: "440px", margin: "0 auto", width: "100%" }}>
      {pollError ? <BuddySessionRoomErrorBanner message={pollError} /> : null}
      <BuddySessionEndPanel
        title="Session ended"
        body="The host left or cancelled. You can return home or join again if you still have the link."
        primary={{ label: "Return home", onClick: onLeave }}
      />
    </div>
  );
}

type BuddySessionCompletedViewProps = {
  pollError: string | null;
  hasPersonalRecordFlow: boolean;
  personalRecordError: string | null;
  isSavingPersonalRecord: boolean;
  onCompleteLegacy: () => void;
  onRetryFinalize: () => void;
  onLeave: () => void;
};

export function BuddySessionCompletedView({
  pollError,
  hasPersonalRecordFlow,
  personalRecordError,
  isSavingPersonalRecord,
  onCompleteLegacy,
  onRetryFinalize,
  onLeave,
}: BuddySessionCompletedViewProps) {
  if (!hasPersonalRecordFlow) {
    return (
      <div style={{ maxWidth: "440px", margin: "0 auto", width: "100%" }}>
        {pollError ? <BuddySessionRoomErrorBanner message={pollError} /> : null}
        <BuddySessionEndPanel
          title="Time is complete"
          body="The shared timer has finished. Sign in on the latest app to save this sit to your personal history."
          primary={{ label: "Done", onClick: onCompleteLegacy }}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "440px", margin: "0 auto", width: "100%" }}>
      {pollError ? <BuddySessionRoomErrorBanner message={pollError} /> : null}
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
            <BuddySessionRoomErrorBanner message={personalRecordError} />
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--s2)" }}>
              <button
                type="button"
                onClick={onRetryFinalize}
                disabled={isSavingPersonalRecord}
                style={{
                  ...btnPrimary,
                  opacity: isSavingPersonalRecord ? 0.65 : 1,
                  cursor: isSavingPersonalRecord ? "not-allowed" : "pointer",
                }}
              >
                {isSavingPersonalRecord ? "Trying again..." : "Try again"}
              </button>
              <button type="button" onClick={onLeave} style={btnSecondary}>
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
