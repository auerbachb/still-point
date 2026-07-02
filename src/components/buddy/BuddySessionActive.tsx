import { useEffect, useRef, useState } from "react";
import type { BuddySnapshot } from "@/lib/api";
import type { SoundPrefs } from "@/lib/audio";
import type { BuddyMindState } from "@/lib/useBuddyMindState";
import type { MindHoldKind } from "@/lib/useMindStateHold";
import { BlockTimer } from "../BlockTimer";
import { BuddyVideo } from "../BuddyVideo";
import { BuddyMindStateControls } from "./BuddyMindStateControls";
import { btnSecondary, inlineLinkButton } from "./buddySessionRoomStyles";

type BuddySessionActiveProps = {
  sessionId: string;
  snap: BuddySnapshot;
  currentUserId: string;
  isMobile: boolean;
  mindState: BuddyMindState;
  mindStateRef: React.MutableRefObject<BuddyMindState>;
  mindStateLog: Array<{ time: number; state: string }>;
  holdKindRef: React.MutableRefObject<MindHoldKind>;
  showPostDistractionCapture: boolean;
  distractionSegmentCount: number;
  sessionThoughts: Array<{ timeInSession: number; text: string }>;
  buddyAwarenessPct: number;
  elapsedRef: React.MutableRefObject<number>;
  soundPrefs: SoundPrefs;
  audioBlocked: boolean;
  dailyMeetingToken: string | null;
  dailyTokenError: string | null;
  finalizeActiveBuddyHold: (atTime: number) => void;
  beginBuddyDistraction: () => void;
  beginBuddyHyperfocus: () => void;
  onElapsedChange: (elapsed: number) => void;
  onSoundPlaybackBlocked: () => void;
  onTimerComplete: () => void;
  onSaveThought: (text: string) => void;
  onDismissPostCapture: () => void;
  onOpenThoughtCapture: () => void;
  onSoundPrefToggle: (key: keyof SoundPrefs) => void;
  onEnableLocalAudio: () => void;
  onLeave: () => void;
};

export function BuddySessionActive({
  sessionId,
  snap,
  currentUserId,
  isMobile,
  mindState,
  mindStateRef,
  mindStateLog,
  holdKindRef,
  showPostDistractionCapture,
  distractionSegmentCount,
  sessionThoughts,
  buddyAwarenessPct,
  elapsedRef,
  soundPrefs,
  audioBlocked,
  dailyMeetingToken,
  dailyTokenError,
  finalizeActiveBuddyHold,
  beginBuddyDistraction,
  beginBuddyHyperfocus,
  onElapsedChange,
  onSoundPlaybackBlocked,
  onTimerComplete,
  onSaveThought,
  onDismissPostCapture,
  onOpenThoughtCapture,
  onSoundPrefToggle,
  onEnableLocalAudio,
  onLeave,
}: BuddySessionActiveProps) {
  const me = snap.participants.find((p) => p.userId === currentUserId);
  const activeInRoom = snap.participants.filter((p) => p.leftAt == null);
  const [controlsVisible, setControlsVisible] = useState(true);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const resetTimer = () => {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setControlsVisible(false), 1000);
    };
    resetTimer();
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("mousedown", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("touchstart", resetTimer, { passive: true });
    return () => {
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("mousedown", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("touchstart", resetTimer);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, []);

  if (!snap.startedAt) return null;

  return (
    <div
      style={
        isMobile
          ? {
              display: "flex",
              flexDirection: "column",
              gap: "var(--s4)",
              width: "100%",
            }
          : {
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) minmax(260px, min(36vw, 380px))",
              gap: "var(--s4)",
              alignItems: "start",
              width: "100%",
            }
      }
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--s4)",
          minWidth: 0,
          order: isMobile ? 1 : undefined,
        }}
      >
        <BlockTimer
          key={`${sessionId}-${snap.startedAt}`}
          totalSeconds={snap.durationSeconds}
          syncClock={{
            startedAt: snap.startedAt,
            serverNow: snap.serverNow,
            durationSeconds: snap.durationSeconds,
          }}
          isActive
          mindState={mindState}
          mindStateLog={mindStateLog}
          onElapsedChange={onElapsedChange}
          onSoundPlaybackBlocked={onSoundPlaybackBlocked}
          soundPrefs={soundPrefs}
          onComplete={onTimerComplete}
        />

        <p
          style={{
            textAlign: "center",
            margin: "-12px 0 0",
            fontSize: "11px",
            color: "var(--fg-3)",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
          }}
        >
          {snap.durationSeconds}s sit · shared timer synced from server · sounds stay local
        </p>
      </div>

      <div
        style={{
          width: "100%",
          order: isMobile ? 2 : undefined,
          ...(isMobile ? {} : { position: "sticky", top: "var(--s4)", alignSelf: "start" }),
        }}
      >
        {snap.dailyRoomUrl?.trim() ? (
          dailyTokenError ? (
            <p
              role="alert"
              style={{
                margin: 0,
                padding: "var(--s4)",
                textAlign: "center",
                fontSize: "13px",
                color: "var(--fg-2)",
                lineHeight: 1.5,
                borderRadius: "12px",
                border: "1px solid var(--border-2)",
                background: "var(--surface-1)",
              }}
            >
              {dailyTokenError}
            </p>
          ) : dailyMeetingToken ? (
            <BuddyVideo
              roomUrl={snap.dailyRoomUrl.trim()}
              meetingToken={dailyMeetingToken}
              displayName={me?.username ?? "Participant"}
            />
          ) : (
            <p
              role="status"
              style={{
                margin: 0,
                padding: "var(--s4)",
                textAlign: "center",
                fontSize: "13px",
                color: "var(--fg-2)",
                lineHeight: 1.5,
                borderRadius: "12px",
                border: "1px solid var(--border-2)",
                background: "var(--surface-1)",
              }}
            >
              Preparing video…
            </p>
          )
        ) : (
          <p
            role="status"
            style={{
              margin: 0,
              padding: "var(--s4)",
              textAlign: "center",
              fontSize: "13px",
              color: "var(--fg-2)",
              lineHeight: 1.5,
              borderRadius: "12px",
              border: "1px solid var(--border-2)",
              background: "var(--surface-1)",
            }}
          >
            Video is not available for this session (server did not return a room link).
          </p>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--s4)",
          minWidth: 0,
          order: isMobile ? 3 : undefined,
          gridColumn: isMobile ? undefined : "1 / -1",
        }}
      >
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "grid",
            gap: "var(--s1)",
          }}
        >
          {activeInRoom.map((p) => (
            <li
              key={p.userId}
              style={{ fontSize: "13px", color: "var(--fg-2)", textAlign: "center" }}
            >
              {p.username}
              {p.connected ? "" : " (away)"}
            </li>
          ))}
        </ul>

        <BuddyMindStateControls
          mindState={mindState}
          mindStateRef={mindStateRef}
          holdKindRef={holdKindRef}
          showPostDistractionCapture={showPostDistractionCapture}
          distractionSegmentCount={distractionSegmentCount}
          sessionThoughtsCount={sessionThoughts.length}
          buddyAwarenessPct={buddyAwarenessPct}
          elapsedRef={elapsedRef}
          finalizeActiveBuddyHold={finalizeActiveBuddyHold}
          beginBuddyDistraction={beginBuddyDistraction}
          beginBuddyHyperfocus={beginBuddyHyperfocus}
          onSaveThought={onSaveThought}
          onDismissPostCapture={onDismissPostCapture}
        />

        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              marginTop: "24px",
            }}
          >
            <div
              aria-hidden={!controlsVisible}
              style={{
                opacity: controlsVisible ? 1 : 0,
                transition: "opacity 0.5s ease",
                pointerEvents: controlsVisible ? "auto" : "none",
              }}
            >
              <button
                type="button"
                onClick={onOpenThoughtCapture}
                disabled={!controlsVisible}
                tabIndex={controlsVisible ? 0 : -1}
                style={{
                  border: "1px solid var(--accent-amber-border)",
                  background: "none",
                  color: "var(--accent-amber-border)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  padding: "10px 24px",
                  borderRadius: "20px",
                  cursor: controlsVisible ? "pointer" : "default",
                }}
              >
                capture note
              </button>
            </div>
            <p
              style={{
                margin: 0,
                fontSize: "11px",
                color: "var(--fg-4)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                textAlign: "center",
              }}
            >
              The timer is shared. Tick, chime, and end sounds play only on this device — if your
              buddy turns them on too, they stay naturally aligned by the shared timer.
            </p>
            {audioBlocked && (
              <p
                role="alert"
                style={{
                  margin: 0,
                  maxWidth: "340px",
                  fontSize: "11px",
                  color: "var(--accent-amber)",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.04em",
                  textAlign: "center",
                  lineHeight: 1.45,
                }}
              >
                Browser audio is paused.
                <button type="button" onClick={onEnableLocalAudio} style={inlineLinkButton}>
                  Enable local audio
                </button>
                on this device.
              </p>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "16px",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
                letterSpacing: "0.1em",
                flexWrap: "wrap",
              }}
            >
              {(
                [
                  ["tick", "tick"],
                  ["chime", "chime"],
                  ["completion", "end"],
                ] as const
              ).map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={soundPrefs[key]}
                  aria-label={`${label} sound ${soundPrefs[key] ? "on" : "off"}; only you hear this`}
                  title="Only you hear this — does not change audio for others"
                  onClick={() => onSoundPrefToggle(key)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: soundPrefs[key] ? "var(--fg-3)" : "var(--fg-4)",
                    transition: "color 0.3s",
                    padding: "4px 8px",
                  }}
                >
                  {soundPrefs[key] ? "\u266A" : "\u2022"} {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p
          style={{
            fontSize: "12px",
            color: "var(--fg-3)",
            textAlign: "center",
            margin: 0,
            lineHeight: 1.45,
          }}
        >
          {snap.isHost
            ? "If you leave, the shared session ends for everyone (only the host can do that)."
            : "If you leave, only your view stops — the shared timer keeps running for everyone else."}
        </p>
        {sessionThoughts.length > 0 && (
          <p
            style={{
              fontSize: "11px",
              color: "var(--fg-4)",
              textAlign: "center",
              margin: 0,
              lineHeight: 1.45,
            }}
          >
            {sessionThoughts.length} thought{sessionThoughts.length === 1 ? "" : "s"} captured on
            this device — they are saved to your journal when you finish the shared session.
          </p>
        )}

        <button
          type="button"
          onClick={onLeave}
          style={{ ...btnSecondary, marginTop: "var(--s1)" }}
        >
          Leave
        </button>
      </div>
    </div>
  );
}
