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

/**
 * The moments a sit announces by feel. Mirrors `HapticCueLogic.Cue`.
 *
 * `minuteMarker` is the ten-second buzz; since #1179 a whole minute plays the
 * `minuteBurst` instead (the name predates that).
 */
export type HapticCue = "minuteMarker" | "secondPulse" | "minuteBurst" | "sessionEnd";

/** The cues with one fixed shape. The burst's shape depends on its tap count. */
export type SingleHapticCue = Exclude<HapticCue, "minuteBurst">;

/**
 * One cue to play. A minute burst carries its tap count. Mirrors
 * `HapticCueLogic.Firing`.
 */
export type HapticFiring =
  | { cue: SingleHapticCue }
  | { cue: "minuteBurst"; taps: number };

/**
 * Vibration patterns in milliseconds; even indices buzz, odd indices pause.
 *
 * The web stand-ins for the iOS strengths. The end of a sit has to be tellable
 * from a marker with your eyes shut, and the every-second pulse from both, so
 * no two share a shape (#1175): a tiny tap each second, one firm buzz per
 * ten-second mark, two long beats for the end. The minute burst is built by
 * {@link minuteBurstPattern}.
 */
export const HAPTIC_PATTERNS: Record<SingleHapticCue, readonly number[]> = {
  secondPulse: [30],
  minuteMarker: [120],
  sessionEnd: [150, 90, 150],
};

/**
 * #1179: the minute countdown burst's tuning — the one constant to retune
 * after a device test. One short tap per whole minute left, `tapMs` long and
 * `tapMs + gapMs` (120 ms) from onset to onset; `maxTaps` null means no cap.
 * Mirrors iOS `HapticCueLogic.minuteBurst`.
 */
export const MINUTE_BURST = { tapMs: 40, gapMs: 80, maxTaps: null as number | null } as const;

/** The taps owed with `wholeMinutesRemaining` whole minutes left. */
export function minuteBurstTapCount(wholeMinutesRemaining: number): number {
  const minutes = Math.max(0, Math.floor(wholeMinutesRemaining));
  const { maxTaps } = MINUTE_BURST;
  return maxTaps === null ? minutes : Math.min(minutes, Math.max(1, maxTaps));
}

/**
 * Chromium truncates a vibration pattern to 99 entries (`kVibrationPatternLengthMax`),
 * and a burst of n taps takes 2n - 1, so 50 taps is the most the platform plays
 * whole. Past that the burst is clamped here rather than silently cut short by
 * the browser. A web-only ceiling: `MINUTE_BURST.maxTaps` stays the product cap.
 */
export const MAX_VIBRATION_PATTERN_ENTRIES = 99;
export const MAX_PLATFORM_BURST_TAPS = Math.floor((MAX_VIBRATION_PATTERN_ENTRIES + 1) / 2);

/** The burst's vibration pattern: `taps` short taps at the tuned spacing. */
export function minuteBurstPattern(taps: number): number[] {
  const count = Math.min(Math.max(1, Math.floor(taps)), MAX_PLATFORM_BURST_TAPS);
  const pattern: number[] = [];
  for (let i = 0; i < count; i++) {
    if (i > 0) pattern.push(MINUTE_BURST.gapMs);
    pattern.push(MINUTE_BURST.tapMs);
  }
  return pattern;
}

/**
 * How long the burst of `taps` this browser plays holds the motor: one
 * tap-plus-gap per tap actually played (after the platform clamp). A finer cue
 * inside it is suppressed by {@link layeredHapticCue}, because a new
 * `navigator.vibrate()` call cancels the pattern still playing and would cut
 * the count short. Mirrors iOS `MinuteBurstTuning.playingSeconds`.
 */
export function minuteBurstPlayingMs(taps: number): number {
  if (!(taps >= 1)) return 0;
  const played = Math.min(Math.floor(taps), MAX_PLATFORM_BURST_TAPS);
  return played * (MINUTE_BURST.tapMs + MINUTE_BURST.gapMs);
}

/** Whether `boundarySeconds` falls while the latest minute mark's burst still plays. */
function isInsidePlayingBurst(boundarySeconds: number, durationSeconds: number): boolean {
  const minuteMark = Math.floor(boundarySeconds / 60) * 60;
  if (!(minuteMark > 0) || !(minuteMark < boundarySeconds)) return false;
  const taps = minuteBurstTapCount(Math.floor((durationSeconds - minuteMark) / 60));
  if (taps < 1) return false;
  return (boundarySeconds - minuteMark) * 1000 < minuteBurstPlayingMs(taps);
}

/** The vibration pattern one firing plays. */
export function hapticPattern(firing: HapticFiring): number[] {
  return firing.cue === "minuteBurst"
    ? minuteBurstPattern(firing.taps)
    : [...HAPTIC_PATTERNS[firing.cue]];
}

function toFiring(cue: SingleHapticCue | HapticFiring): HapticFiring {
  return typeof cue === "string" ? { cue } : cue;
}

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
export function fireHaptic(cue: SingleHapticCue | HapticFiring): boolean {
  if (!supportsVibration()) return false;
  try {
    return navigator.vibrate(hapticPattern(toFiring(cue)));
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
 * #1179: the one cue a boundary of the chosen interval plays at
 * `boundarySeconds` into the sit, or null. Mirrors iOS
 * `HapticCueLogic.layeredCue`.
 *
 * The interval is the finest cue; every coarser one still plays, and a
 * boundary that is several at once plays only the coarsest: minute burst, then
 * ten-second buzz, then second pulse. The end of the sit outranks them all and
 * is never a boundary here ({@link planSessionEndCues} owns it), so 0:00 is the
 * end, not a 0-tap burst. A minute mark with less than a whole minute left (a
 * sit with bonus seconds) is no burst and falls through to the finer layers the
 * interval allows.
 *
 * A finer cue whose boundary falls while the latest minute burst is still
 * playing ({@link minuteBurstPlayingMs}) is suppressed: on web the new
 * `vibrate()` would cancel the burst mid-count.
 */
export function layeredHapticCue(
  boundarySeconds: number,
  durationSeconds: number,
  intervalSeconds: number,
): HapticFiring | null {
  if (!isHapticIntervalSeconds(intervalSeconds)) return null;
  if (!(boundarySeconds > 0) || !(boundarySeconds < durationSeconds)) return null;
  if (boundarySeconds % intervalSeconds !== 0) return null;
  if (boundarySeconds % 60 === 0) {
    const taps = minuteBurstTapCount(Math.floor((durationSeconds - boundarySeconds) / 60));
    if (taps >= 1) return { cue: "minuteBurst", taps };
  }
  if (isInsidePlayingBurst(boundarySeconds, durationSeconds)) return null;
  if (intervalSeconds !== 60 && boundarySeconds % 10 === 0) return { cue: "minuteMarker" };
  if (intervalSeconds === 1) return { cue: "secondPulse" };
  return null;
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
  cue: SingleHapticCue | HapticFiring,
): boolean {
  if (hapticsEnabled !== true) return false;
  return fireHaptic(cue);
}
