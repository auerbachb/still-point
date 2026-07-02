import type { BuddySnapshot } from "@/lib/api";
import { BUDDY_SESSION_LENGTH_EXPLAINER } from "@/lib/buddySessionDuration";
import { formatScheduledStart } from "@/lib/buddySessionRoomUtils";
import { btnGhost, btnPrimary, btnSecondary } from "./buddySessionRoomStyles";

type BuddySessionLobbyProps = {
  snap: BuddySnapshot;
  currentUserId: string;
  calendarMessage?: string | null;
  onSetReady: (ready: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
  onLeave: () => void;
};

export function BuddySessionLobby({
  snap,
  currentUserId,
  calendarMessage,
  onSetReady,
  onStart,
  onCancel,
  onLeave,
}: BuddySessionLobbyProps) {
  const me = snap.participants.find((p) => p.userId === currentUserId);
  const activeInRoom = snap.participants.filter((p) => p.leftAt == null);
  const lobbyReady = snap.state === "ready_check";

  return (
    <>
      {snap.scheduledStartAt && (
        <p
          role="note"
          style={{
            margin: 0,
            fontSize: "13px",
            color: "var(--fg-2)",
            textAlign: "center",
            lineHeight: 1.45,
          }}
        >
          Scheduled for {formatScheduledStart(snap.scheduledStartAt)}. Joining confirms the shared
          time; connected Google Calendars add it automatically.
        </p>
      )}

      {calendarMessage && (
        <p
          role="status"
          style={{
            margin: 0,
            fontSize: "12px",
            color: "var(--fg-3)",
            textAlign: "center",
            lineHeight: 1.45,
          }}
        >
          {calendarMessage}
        </p>
      )}

      <p
        role="note"
        style={{
          margin: 0,
          fontSize: "13px",
          color: "var(--fg-2)",
          textAlign: "center",
          lineHeight: 1.45,
        }}
      >
        {BUDDY_SESSION_LENGTH_EXPLAINER}
      </p>

      <div
        role="status"
        style={{
          textAlign: "center",
          margin: 0,
          padding: "22px 24px",
          borderRadius: "16px",
          fontFamily: "var(--font-mono)",
          fontSize: "clamp(15px, 3.8vw, 18px)",
          lineHeight: 1.45,
          letterSpacing: "0.04em",
          border: lobbyReady ? "2px solid var(--accent-green)" : "1px solid var(--border-2)",
          background: lobbyReady ? "var(--accent-green-bg-subtle)" : "var(--surface-1)",
          color: lobbyReady ? "var(--accent-green)" : "var(--fg-2)",
          boxSizing: "border-box",
        }}
      >
        {lobbyReady
          ? "Everyone is ready — host can start."
          : "Waiting for everyone to join and mark ready."}
      </div>

      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: "var(--s3)",
        }}
      >
        {activeInRoom.map((p) => (
          <li
            key={p.userId}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--s3)",
              padding: "22px 24px",
              minHeight: "72px",
              border: "1px solid var(--border-2)",
              borderRadius: "16px",
              background: "var(--surface-1)",
              boxSizing: "border-box",
            }}
          >
            <span
              style={{
                color: "var(--fg)",
                fontSize: "clamp(18px, 4.5vw, 22px)",
                fontFamily: "var(--font-serif)",
              }}
            >
              {p.username}
              {p.isHost ? " · host" : ""}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "12px",
                fontSize: "clamp(14px, 3.5vw, 17px)",
                color: "var(--fg-2)",
                fontFamily: "var(--font-serif)",
                flexShrink: 0,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: p.connected ? "var(--accent-green)" : "var(--fg-4)",
                  boxShadow: p.connected
                    ? "0 0 0 3px var(--accent-green-border-subtle)"
                    : "none",
                }}
              />
              <span>
                {p.connected ? "online" : "away"}
                {p.ready ? " · ready" : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {!snap.isHost && (
        <p
          role="note"
          style={{
            margin: 0,
            fontSize: "12px",
            color: "var(--fg-3)",
            textAlign: "center",
            lineHeight: 1.45,
          }}
        >
          Only the host can start or cancel the shared session. Your ready toggle is just for you.
        </p>
      )}

      {me && (
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "20px",
            cursor: "pointer",
            fontSize: "clamp(19px, 4.5vw, 24px)",
            color: "var(--fg)",
            padding: "20px 24px",
            minHeight: "76px",
            border: `2px solid ${me.ready ? "var(--accent-green)" : "var(--border-2)"}`,
            borderRadius: "16px",
            background: me.ready ? "var(--accent-green-bg-faint)" : "var(--surface-1)",
            boxSizing: "border-box",
          }}
        >
          <input
            type="checkbox"
            checked={me.ready}
            onChange={(e) => onSetReady(e.target.checked)}
            style={{
              width: "40px",
              height: "40px",
              minWidth: "40px",
              minHeight: "40px",
              margin: 0,
              cursor: "pointer",
              accentColor: "var(--accent-green)",
              flexShrink: 0,
            }}
          />
          I&apos;m ready
        </label>
      )}

      {snap.isHost && (
        <div style={{ display: "grid", gap: "var(--s2)" }}>
          <button
            type="button"
            onClick={onStart}
            disabled={snap.state !== "ready_check"}
            title={
              snap.state !== "ready_check"
                ? "Everyone must join and mark ready before you can start the shared timer for all."
                : "Starts the same timer for everyone in the room."
            }
            style={{
              ...btnPrimary,
              opacity: snap.state !== "ready_check" ? 0.45 : 1,
              cursor: snap.state !== "ready_check" ? "not-allowed" : "pointer",
            }}
          >
            Start for everyone
          </button>
          {snap.state !== "ready_check" && (
            <p
              role="note"
              style={{
                margin: 0,
                fontSize: "12px",
                color: "var(--fg-3)",
                textAlign: "center",
                lineHeight: 1.45,
              }}
            >
              Start is a shared action for the host only. It unlocks when everyone has joined and
              marked ready.
            </p>
          )}
          <button
            type="button"
            onClick={onCancel}
            style={btnSecondary}
            title="Ends the invite for everyone. Only the host can cancel before the sit starts."
          >
            Cancel session
          </button>
        </div>
      )}

      <button type="button" onClick={onLeave} style={btnGhost}>
        Leave
      </button>
    </>
  );
}
