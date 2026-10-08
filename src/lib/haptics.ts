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
 *
 * Strict `=== true` rather than a truthiness check. The value reaches here from
 * `JSON.parse` of localStorage, which the type annotation cannot vouch for: a
 * stored string `"false"` is truthy and would buzz a sitter whose saved setting
 * reads false. An opt-in that promises stillness has to fail closed, so anything
 * that is not literally `true` means no.
 */
/** The only two repeating intervals. Anything else falls back to every minute. */
export const HAPTIC_INTERVAL_SECONDS = [10, 60] as const;
export type HapticIntervalSeconds = (typeof HAPTIC_INTERVAL_SECONDS)[number];

export function hapticIntervalSeconds(value: unknown): HapticIntervalSeconds {
  return value === 10 || value === "tenSeconds" ? 10 : 60;
}

/**
 * Highest completed interval strictly before the end of the sit.
 * Seeding at the duration does not count the end itself as a repeating mark.
 */
export function completedHapticIntervalIndex(
  elapsedSeconds: number,
  durationSeconds: number,
  intervalSeconds: number,
): number {
  if (intervalSeconds !== 10 && intervalSeconds !== 60) return 0;
  if (elapsedSeconds < 0 || durationSeconds <= 0) return 0;
  const capped = Math.min(elapsedSeconds, durationSeconds - 1e-9);
  return Math.floor(Math.max(0, capped) / intervalSeconds);
}

/**
 * Session-origin repeating haptic. A sit has to be longer than one interval.
 * The boundary that lands on the end is not a repeating cue. A jump fires once.
 */
export function nextRepeatingHaptic(input: {
  elapsedSeconds: number;
  durationSeconds: number;
  intervalSeconds: number;
  lastCompletedIndex: number;
}): { completedIndex: number; shouldFire: boolean } {
  const { elapsedSeconds, durationSeconds, intervalSeconds, lastCompletedIndex } = input;
  if (intervalSeconds !== 10 && intervalSeconds !== 60) {
    return { completedIndex: lastCompletedIndex, shouldFire: false };
  }
  if (!(durationSeconds > intervalSeconds) || elapsedSeconds < 0) {
    return { completedIndex: lastCompletedIndex, shouldFire: false };
  }
  if (elapsedSeconds >= durationSeconds) {
    const finalIndex = completedHapticIntervalIndex(
      durationSeconds,
      durationSeconds,
      intervalSeconds,
    );
    return {
      completedIndex: Math.max(lastCompletedIndex, finalIndex),
      shouldFire: false,
    };
  }
  const completedIndex = Math.floor(elapsedSeconds / intervalSeconds);
  const boundary = completedIndex * intervalSeconds;
  const shouldFire =
    completedIndex > lastCompletedIndex &&
    completedIndex >= 1 &&
    boundary < durationSeconds;
  return {
    completedIndex: Math.max(lastCompletedIndex, completedIndex),
    shouldFire,
  };
}

export function maybeFireHaptic(
  hapticsEnabled: boolean | undefined,
  cue: HapticCue,
): boolean {
  if (hapticsEnabled !== true) return false;
  return fireHaptic(cue);
}
