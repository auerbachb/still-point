/**
 * #712 — vibration cues, for a sitter who wants the sit marked by feel rather
 * than by sound.
 *
 * The web half of `ios/StillPointShared/Sources/StillPointShared/HapticCueLogic.swift`;
 * keep the cue names and the gentle/pronounced split in step with it.
 *
 * **Reach is narrow, deliberately so.** The Vibration API is absent from Safari
 * on every platform — so also from an iOS home-screen PWA — and from desktop
 * Safari and desktop Firefox. In practice this fires on Android Chrome and
 * Android Firefox and nowhere else. The native iOS app is where a silent sitter
 * is actually served; this is progressive enhancement layered on top, never a
 * path anything depends on. Every entry point degrades to a silent no-op.
 *
 * Unlike iOS, the abandon and end-early exclusions are not parameters here: the
 * three call sites in `BlockTimer.tsx` exist only on the natural-completion and
 * live-minute-boundary paths, so a discarded sit never reaches them.
 */

/** The two moments a sit announces by feel. Mirrors `HapticCueLogic.Cue`. */
export type HapticCue = "minuteMarker" | "sessionEnd";

/**
 * Vibration patterns in milliseconds; even indices buzz, odd indices pause.
 *
 * The web stand-ins for the two iOS generators. The end of a sit has to be
 * tellable from a minute marker with your eyes shut, so the two never share a
 * shape: one short tap versus two firmer beats.
 */
export const HAPTIC_PATTERNS: Record<HapticCue, readonly number[]> = {
  minuteMarker: [40],
  sessionEnd: [90, 80, 90],
};

/** Whether this browser can vibrate at all. */
export function supportsVibration(): boolean {
  return (
    typeof navigator !== "undefined" && typeof navigator.vibrate === "function"
  );
}

/**
 * Fires a cue. Returns whether the browser accepted it — false on every browser
 * without the Vibration API, which is most of them.
 */
export function fireHaptic(cue: HapticCue): boolean {
  if (!supportsVibration()) return false;
  try {
    return navigator.vibrate([...HAPTIC_PATTERNS[cue]]);
  } catch {
    // Some engines throw rather than return false when the page has no user
    // activation yet. A cue that cannot fire is not an error worth surfacing
    // mid-sit — the sit is the point, not the buzz.
    return false;
  }
}

/**
 * The single gate the session timer calls: fires `cue` only when the preference
 * is on. Never reads the sound preferences — silencing the bell must not
 * silence the buzz, which is the whole reason this pref exists.
 */
export function maybeFireHaptic(
  hapticsEnabled: boolean | undefined,
  cue: HapticCue,
): boolean {
  if (!hapticsEnabled) return false;
  return fireHaptic(cue);
}
