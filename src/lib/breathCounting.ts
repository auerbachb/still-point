// Pure breath-counting helpers — web port of iOS `BreathCounting`
// (ios/StillPointShared/Sources/StillPointShared/BreathCountingLogic.swift, #374).
// No DOM/timer state lives here so the logic stays unit-testable; the view owns
// the tap count and wall-clock start time and calls into these functions.

/**
 * Which side of a breath the user is on.
 *
 * Phase semantics: taps alternate inhale / exhale.
 *   - tap 1 → first inhale  → tapCount 1 (odd)  → next expected phase is "exhale"
 *   - tap 2 → first exhale  → tapCount 2 (even) → one full breath done, next is "inhale"
 *   - tap 3 → second inhale → tapCount 3 (odd)  → next expected phase is "exhale"
 *
 * So `phaseForTaps` returns the *next expected* action:
 *   even tapCount (incl. 0) → "inhale"
 *   odd  tapCount           → "exhale"
 */
export type BreathPhase = "inhale" | "exhale";

/** Number of complete breaths (1 breath = 1 inhale + 1 exhale = 2 taps). */
export function breathCountForTaps(taps: number): number {
  return Math.floor(Math.max(0, taps) / 2);
}

/**
 * The *next expected* breath phase given how many taps have been recorded.
 *
 * - Even tapCount (0, 2, 4, …): inhale is next.
 * - Odd tapCount (1, 3, 5, …): exhale is next.
 */
export function phaseForTaps(taps: number): BreathPhase {
  return Math.max(0, taps) % 2 === 0 ? "inhale" : "exhale";
}

/**
 * Elapsed whole seconds between two epoch-millisecond timestamps, clamped to a
 * minimum of 0. Uses wall-clock difference so the count survives tab
 * backgrounding without drift (matches the iOS wall-clock approach).
 */
export function elapsedSeconds(startMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - startMs) / 1000));
}

/**
 * Format a second count as "M:SS" or "MM:SS".
 *
 * Examples:
 *   0   → "0:00"
 *   65  → "1:05"
 *   600 → "10:00"
 */
export function elapsedDisplay(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(s / 60);
  const secs = s % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}
