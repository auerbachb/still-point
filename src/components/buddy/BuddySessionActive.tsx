import { useEffect, useRef, useState } from "react";
import type { BuddySnapshot } from "@/lib/api";
import type { CueMode, HapticInterval, SoundPrefs } from "@/lib/audio";
import { CueModeControl, HapticIntervalControl } from "../CueModeControl";
import {
  SOUND_TOGGLE_MIN_TAP_TARGET_PX,
  soundToggleAccessibilityLabel,
  soundToggleAppearance,
  type SoundToggleCue,
} from "@/lib/soundToggleAppearance";
import type { BuddyMindState } from "@/lib/useBuddyMindState";
import type { MindHoldKind } from "@/lib/useMindStateHold";
import { BlockTimer } from "../BlockTimer";
import { BuddyVideo } from "../BuddyVideo";
import { BuddyMindStateControls } from "./BuddyMindStateControls";
import { AudioBlockedBanner } from "../AudioBlockedBanner";
import { btnSecondary } from "./buddySessionRoomStyles";

/**
 * Same glyph as `SessionView`'s sound toggle (#668). Inline here so the buddy
 * row does not import the solo screen. A speaker (or phone, for haptics) carries
 * on/off together with the pill fill and border.
 */
function SoundToggleIcon({
  muted,
  cue = "audio",
}: {
  muted: boolean;
  cue?: SoundToggleCue;
}) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {cue === "haptic" ? (
        <>
          <rect x="5.5" y="2" width="5" height="12" rx="1.25" />
          {muted ? (
            <path d="M3.5 13.5l9-11" />
          ) : (
            <>
              <path d="M3.25 5.75a4 4 0 000 4.5" />
              <path d="M12.75 5.75a4 4 0 010 4.5" />
            </>
          )}
        </>
      ) : (
        <>
          <path d="M3 6h2l3-2.5v9L5 10H3z" fill="currentColor" stroke="none" />
          {muted ? (
            <path d="M10.5 6l4 4m0-4l-4 4" />
          ) : (
            <>
              <path d="M10.5 5.75a3 3 0 010 4.5" />
              <path d="M12.75 4a5.5 5.5 0 010 8" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

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
  onSoundPlaybackResumed: () => void;
  onTimerComplete: () => void;
  onSaveThought: (text: string) => void;
  onDismissPostCapture: () => void;
  onOpenThoughtCapture: () => void;
  onSoundPrefToggle: (key: keyof SoundPrefs) => void;
  onCueMode: (mode: CueMode) => void;
  onHapticInterval: (interval: HapticInterval) => void;
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
  onSoundPlaybackResumed,
  onTimerComplete,
  onSaveThought,
  onDismissPostCapture,
  onOpenThoughtCapture,
  onSoundPrefToggle,
  onCueMode,
  onHapticInterval,
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
          onSoundPlaybackResumed={onSoundPlaybackResumed}
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
              <AudioBlockedBanner onEnableLocalAudio={onEnableLocalAudio} />
            )}
            {/*
              #689: the same #668 pills as the solo sit. On/off is fill, border,
              and icon — not a shift between two greys. flexWrap plus the same
              width clamp as BuddyMindStateControls keeps five pills inside a
              320px phone next to the video column.
            */}
            <div
              data-testid="buddySession.soundToggles"
              style={{
                display: "flex",
                justifyContent: "center",
                flexWrap: "wrap",
                gap: "6px",
                maxWidth: "min(420px, calc(100vw - 40px))",
                width: "100%",
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                letterSpacing: "0.06em",
              }}
            >
              <CueModeControl
                prefs={soundPrefs}
                onChange={onCueMode}
                testId="buddySession.cueMode"
                onlyYou
              />
              {soundPrefs.haptics && (
                <HapticIntervalControl
                  value={soundPrefs.hapticInterval}
                  onChange={onHapticInterval}
                  testId="buddySession.hapticInterval"
                />
              )}
              {(
                [
                  ["chime", "chime", "audio"],
                  ["completion", "end", "audio"],
                ] as const
              ).map(([key, label, cue]) => {
                const isOn = soundPrefs[key];
                const appearance = soundToggleAppearance(isOn, cue);
                return (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={isOn}
                    aria-label={`${soundToggleAccessibilityLabel(label, cue)}; only you hear this`}
                    title="Only you hear this — does not change audio for others"
                    data-testid={`buddySession.soundToggle.${label}`}
                    onClick={() => onSoundPrefToggle(key)}
                    style={{
                      background: appearance.isFilled ? "var(--surface-3)" : "transparent",
                      border: `1px solid ${
                        appearance.hasProminentBorder ? "var(--border-2)" : "var(--border-1)"
                      }`,
                      cursor: "pointer",
                      color: isOn ? "var(--fg-2)" : "var(--fg-4)",
                      transition: "background 0.2s, border-color 0.2s, color 0.2s",
                      padding: "0 10px",
                      minHeight: `${SOUND_TOGGLE_MIN_TAP_TARGET_PX}px`,
                      borderRadius: `${SOUND_TOGGLE_MIN_TAP_TARGET_PX / 2}px`,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "5px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <SoundToggleIcon muted={appearance.isIconMuted} cue={cue} />
                    {label}
                  </button>
                );
              })}
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
