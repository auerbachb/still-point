/** Targets where Space should not start a distraction hold (typing, thought capture, etc.). */
export function isMindStateTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return Boolean(el.closest("[data-no-space-distraction]"));
}

/** Same formula as session completion: % of elapsed time in `"clear"` (aware) vs `"thinking"` (distraction). */
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
    if (lastState === "clear") clearTime += entry.time - lastTime;
    lastTime = entry.time;
    lastState = entry.state;
  }
  const denom = Math.max(endTime, 1);
  return Math.round((clearTime / denom) * 100);
}
