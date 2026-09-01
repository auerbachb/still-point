/**
 * #668 — presentation rules for the mid-session sound toggles (tick / chime /
 * voice / end).
 *
 * The row used to be four bare lowercase words whose only state cue was a shift
 * between two muted greys (`--fg-3` on, `--fg-4` off). Mid-sit, on a phone, that
 * is neither obviously tappable nor obviously on.
 *
 * Port of `ios/StillPointShared/Sources/StillPointShared/SoundToggleAppearance.swift`
 * so both clients derive the same appearance from one rule set — keep the two in
 * step. Nothing here touches audio: the toggle side effects stay in the click
 * handler in `SessionView.tsx` (web) and `SoundToggleLogic` (#667, iOS).
 */

/** Minimum tap target for a sound toggle (WCAG 2.5.5 44px / Apple HIG 44pt). */
export const SOUND_TOGGLE_MIN_TAP_TARGET_PX = 44;

/**
 * The visual channels that carry on/off state.
 *
 * Three redundant cues, deliberately: an off state that only differs in text
 * colour is unreadable at a glance and fails "does not rely on a subtle two-grey
 * color difference alone". Anything that collapses these into a single channel
 * breaks `soundToggleAppearance.test.ts`.
 */
/**
 * Which channel a toggle controls.
 *
 * #712 added a pill that governs vibration rather than sound. A speaker glyph on
 * it would be a plain lie — the whole point of the control is that nothing is
 * heard — so the cue picks the glyph family and the wording.
 */
export type SoundToggleCue = "audio" | "haptic";

export type SoundToggleAppearance = {
  /** Pill is filled (on) rather than transparent (off). */
  isFilled: boolean;
  /** Pill border is the stronger tier (on) rather than the faint tier (off). */
  hasProminentBorder: boolean;
  /** Icon shows the struck-through glyph (off) rather than the active one (on). */
  isIconMuted: boolean;
  /** Which channel this pill governs — picks the glyph family. */
  cue: SoundToggleCue;
};

/** Resolves every visual channel from the on/off input and the cue channel. */
export function soundToggleAppearance(
  isOn: boolean,
  cue: SoundToggleCue = "audio",
): SoundToggleAppearance {
  return { isFilled: isOn, hasProminentBorder: isOn, isIconMuted: !isOn, cue };
}

/**
 * UI-test hook, unchanged by the restyle. iOS `StillPointAppUITests` and the web
 * e2e suite both address the toggles through this identifier.
 */
export function soundToggleTestId(label: string): string {
  return `session.soundToggle.${label}`;
}

/**
 * Accessible name. Keeps the visible word first so speech input ("click tick")
 * still matches the label a sighted user reads (WCAG 2.5.3 Label in Name).
 *
 * The suffix follows the cue: announcing the haptics pill as "haptics sound"
 * would tell a screen-reader user the opposite of what it does.
 */
export function soundToggleAccessibilityLabel(
  label: string,
  cue: SoundToggleCue = "audio",
): string {
  return cue === "haptic" ? `${label} feedback` : `${label} sound`;
}

/**
 * Human-readable state, for the screen-reader announcement. The web control is a
 * `<button aria-pressed>`, so assistive tech derives "pressed"/"not pressed" on
 * its own; this string backs the `title` tooltip and keeps the announced wording
 * identical to iOS's `accessibilityValue`.
 */
export function soundToggleStateText(isOn: boolean): string {
  return isOn ? "on" : "off";
}
