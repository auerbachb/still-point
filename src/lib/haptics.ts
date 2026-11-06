/**
 * #712 — vibration cues, for a sitter who wants the sit marked by feel rather
 * than by sound.
 *
 * The web half of `ios/StillPointShared/Sources/StillPointShared/HapticCueLogic.swift`;
 * keep the cue names and the pulse/marker/pronounced split in step with it.
 *
 * **Reach is narrow, deliberately so.** The Vibration API is absent from Safari
 * on every platform — so also from an iOS home-screen PWA — and from desktop
 * Safari and desktop Firefox. In practice this fires on Android Chrome and
 * Android Firefox and nowhere else. The native iOS app is where a silent sitter
 * is actually served; this is progressive enhancement layered on top, never a
 * path anything depends on. Every entry point degrades to a silent no-op.
 *
 * Unlike iOS, the abandon and end-early exclusions are not parameters here: the
 * session timer plans these cues only on the natural-completion and
 * live-interval-boundary paths (`planSessionEndCues` and `planCountdownCues` in
 * `sessionCues.ts`), so a discarded sit never reaches them.
 */

/** The moments a sit announces by feel. Mirrors `HapticCueLogic.Cue`. */
export type HapticCue = "minuteMarker" | "secondPulse" | "sessionEnd";

/**
 * Vibration patterns in milliseconds; even indices buzz, odd indices pause.
 *
 * The web stand-ins for the iOS strengths. The end of a sit has to be tellable
 * from a marker with your eyes shut, and the every-second pulse from both, so
 * no two share a shape (#1175): a tiny tap each second, one firm buzz per
 * minute or ten-second mark, two long beats for the end.
 */
export const HAPTIC_PATTERNS: Record<HapticCue, readonly number[]> = {
  secondPulse: [30],
  minuteMarker: [120],
  sessionEnd: [150, 90, 150],
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
/** The only three repeating intervals. Anything else falls back to every minute. */
export const HAPTIC_INTERVAL_SECONDS = [1, 10, 60] as const;
export type HapticIntervalSeconds = (typeof HAPTIC_INTERVAL_SECONDS)[number];

export function hapticIntervalSeconds(value: unknown): HapticIntervalSeconds {
  if (value === 1 || value === "everySecond") return 1;
  if (value === 10 || value === "tenSeconds") return 10;
  return 60;
}

function isHapticIntervalSeconds(value: number): value is HapticIntervalSeconds {
  return (HAPTIC_INTERVAL_SECONDS as readonly number[]).includes(value);
}

/**
 * #1175: the cue each repeating boundary plays. Every second plays the tiny
 * pulse; every minute and every 10 sec play the firm marker. Mirrors
 * `HapticCueLogic.Interval.cue`.
 */
export function repeatingHapticCue(intervalSeconds: number): HapticCue {
  return intervalSeconds === 1 ? "secondPulse" : "minuteMarker";
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
  if (!isHapticIntervalSeconds(intervalSeconds)) return 0;
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
  if (!isHapticIntervalSeconds(intervalSeconds)) {
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
