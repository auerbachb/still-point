"use client";

import {
  SOUND_TOGGLE_MIN_TAP_TARGET_PX,
  soundToggleAccessibilityLabel,
  soundToggleAppearance,
  soundToggleStateText,
  soundToggleTestId,
  type SoundToggleCue,
} from "@/lib/soundToggleAppearance";
import type { useAudioUnlock } from "@/lib/useAudioUnlock";
import { CueModeControl, HapticIntervalControl } from "../CueModeControl";
import { mono } from "./sessionViewStyles";

type AudioUnlock = ReturnType<typeof useAudioUnlock>;

/**
 * #668: the speaker glyph inside a sound toggle. Inline SVG rather than a text
 * glyph so the on/off shapes are the same pair iOS draws with SF Symbols
 * (`speaker.wave.2.fill` / `speaker.slash.fill`) instead of whatever the device
 * font happens to have for `♪`.
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
          {/* #712: a phone throwing off waves reads as "this buzzes" where a
              speaker would read as "this makes a noise". Mirrors the iOS pair
              iphone.radiowaves.left.and.right / iphone.slash. */}
          <rect x="5.5" y="2" width="5" height="12" rx="1.25" />
          {muted ? (
            // Off: a slash across the phone.
            <path d="M3.5 13.5l9-11" />
          ) : (
            // On: waves leaving both sides.
            <>
              <path d="M3.25 5.75a4 4 0 000 4.5" />
              <path d="M12.75 5.75a4 4 0 010 4.5" />
            </>
          )}
        </>
      ) : (
        <>
          {/* Speaker body, shared by both states. */}
          <path d="M3 6h2l3-2.5v9L5 10H3z" fill="currentColor" stroke="none" />
          {muted ? (
            // Off: a slash through the waves.
            <path d="M10.5 6l4 4m0-4l-4 4" />
          ) : (
            // On: two sound waves, matching speaker.wave.2.fill.
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

type SessionSoundControlsProps = {
  isMobile: boolean;
  soundPrefs: AudioUnlock["soundPrefs"];
  setCueMode: AudioUnlock["setCueMode"];
  setHapticInterval: AudioUnlock["setHapticInterval"];
  onSoundPrefToggle: AudioUnlock["handleSoundPrefToggle"];
};

/**
 * Tick, haptic, and voice are one segmented choice. Chime and the end
 * bell stay independent pills.
 */
export function SessionSoundControls({
  isMobile,
  soundPrefs,
  setCueMode,
  setHapticInterval,
  onSoundPrefToggle,
}: SessionSoundControlsProps) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px",
        marginTop: isMobile ? "8px" : "24px",
        ...mono,
        fontSize: "10px",
        letterSpacing: "0.06em",
      }}
    >
      <CueModeControl prefs={soundPrefs} onChange={setCueMode} testId="session.cueMode" />
      {soundPrefs.haptics && (
        <HapticIntervalControl
          value={soundPrefs.hapticInterval}
          onChange={setHapticInterval}
          testId="session.hapticInterval"
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
            // Native button + aria-pressed: assistive tech announces
            // "tick sound, toggle button, pressed" and re-announces on change,
            // so the state never depends on seeing the fill.
            aria-pressed={isOn}
            aria-label={soundToggleAccessibilityLabel(label, cue)}
            // Becomes the accessible *description*, not the name. Deliberately
            // restates the state in words: it is the hover tooltip for mouse
            // users, and a plain-language fallback on the older
            // browser/screen-reader pairs that handle `aria-pressed` poorly.
            title={`${soundToggleAccessibilityLabel(label, cue)} — ${soundToggleStateText(isOn)}`}
            data-testid={soundToggleTestId(label)}
            data-sound-toggle={label}
            data-state={soundToggleStateText(isOn)}
            onClick={() => onSoundPrefToggle(key)}
            style={{
              background: appearance.isFilled ? "var(--surface-3)" : "transparent",
              border: `1px solid ${
                appearance.hasProminentBorder ? "var(--border-2)" : "var(--border-1)"
              }`,
              cursor: "pointer",
              color: isOn ? "var(--fg-2)" : "var(--fg-4)",
              transition: "background 0.2s, border-color 0.2s, color 0.2s",
              // Padding plus this min-height makes the *visible* pill the tap
              // target, rather than a small glyph inside an invisible one.
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
  );
}
