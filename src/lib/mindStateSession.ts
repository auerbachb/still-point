/**
 * Helpers for mind-state / distraction keyboard handling and clear-percent math.
 * Used by solo `SessionView` and `BuddySessionRoom`.
 */

/**
 * Returns true when the event target is a control where global shortcuts
 * (Space, Comma) should not start a distraction/hyperfocus hold.
 */
export function isMindStateTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[data-no-space-distraction]"));
}

/**
 * Computes the percentage of `[0, endTime]` spent in `"clear"` (aware) vs other
 * logged states, using the same replay rules as session completion.
 *
 * @param log Ordered transitions `{ time, state }` with `time` in session seconds.
 * @param endTime Session elapsed seconds to treat as the interval end (exclusive of tail marker logic uses inclusive segments).
 */
function isAwareLikeState(state: string): boolean {
  return state === "clear" || state === "hyperfocus";
}

export function computeClearPercentFromLog(
  log: Array<{ time: number; state: string }>,
  endTime: number,
): number {
  if (log.length === 0) return 100;
  let clearTime = 0;
  let lastTime = 0;
  let lastState = "clear";
  const full = [...log, { time: endTime, state: "clear" }];
  for (const entry of full) {
    if (isAwareLikeState(lastState)) clearTime += entry.time - lastTime;
    lastTime = entry.time;
    lastState = entry.state;
  }
  const denom = Math.max(endTime, 1);
  return Math.round((clearTime / denom) * 100);
}
