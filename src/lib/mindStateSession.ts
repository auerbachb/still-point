/**
 * Helpers for mind-state / distraction keyboard handling and clear-percent math.
 * Used by solo `SessionView` and `BuddySessionRoom`.
 *
 * Hyperfocus intervals are stored in the existing `mindStateLog` JSON as
 * `{ time, state: "hyperfocus" }` entries — the same shape as distraction
 * (`"thinking"`) holds from #72.
 */

export type MindHoldKind = "none" | "pointerHold" | "spaceDistraction" | "commaHyperfocus";

export type MindHoldKeyboardState = {
  holdKind: MindHoldKind;
  spaceDown: boolean;
  commaDown: boolean;
};

export type MindHoldKeyEffect =
  | { type: "preventDefault" }
  | { type: "beginDistraction" }
  | { type: "beginHyperfocus" }
  | { type: "endHold" };

type KeyboardLikeEvent = Pick<KeyboardEvent, "code" | "key" | "repeat" | "target">;

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

export function isSpaceHoldKey(e: Pick<KeyboardEvent, "code" | "key">): boolean {
  return e.code === "Space" || e.key === " " || e.key === "Space";
}

export function isCommaHoldKey(e: Pick<KeyboardEvent, "code" | "key">): boolean {
  return e.code === "Comma" || e.key === ",";
}

export function createInitialMindHoldKeyboardState(): MindHoldKeyboardState {
  return { holdKind: "none", spaceDown: false, commaDown: false };
}

/**
 * Pure reducer for Space (distraction) and Comma (hyperfocus) keydown handling.
 * Pointer holds set `holdKind` to `"pointerHold"` in the parent; keyboard holds
 * only begin when `holdKind === "none"`.
 */
export function reduceMindHoldKeyDown(
  state: MindHoldKeyboardState,
  e: KeyboardLikeEvent,
): { state: MindHoldKeyboardState; effects: MindHoldKeyEffect[] } {
  if (isMindStateTypingTarget(e.target)) {
    return { state, effects: [] };
  }

  if (isSpaceHoldKey(e) && !e.repeat) {
    const effects: MindHoldKeyEffect[] = [{ type: "preventDefault" }];
    const next = { ...state, spaceDown: true };
    if (state.holdKind === "none") {
      next.holdKind = "spaceDistraction";
      effects.push({ type: "beginDistraction" });
    }
    return { state: next, effects };
  }

  if (isCommaHoldKey(e) && !e.repeat) {
    const effects: MindHoldKeyEffect[] = [{ type: "preventDefault" }];
    const next = { ...state, commaDown: true };
    if (state.holdKind === "none") {
      next.holdKind = "commaHyperfocus";
      effects.push({ type: "beginHyperfocus" });
    }
    return { state: next, effects };
  }

  return { state, effects: [] };
}

/** Pure reducer for Space/Comma keyup — ends the matching keyboard hold only. */
export function reduceMindHoldKeyUp(
  state: MindHoldKeyboardState,
  e: Pick<KeyboardEvent, "code" | "key">,
): { state: MindHoldKeyboardState; effects: MindHoldKeyEffect[] } {
  if (isSpaceHoldKey(e)) {
    if (!state.spaceDown) return { state, effects: [] };
    const effects: MindHoldKeyEffect[] = [{ type: "preventDefault" }];
    const next = { ...state, spaceDown: false };
    if (state.holdKind === "spaceDistraction") {
      next.holdKind = "none";
      effects.push({ type: "endHold" });
    }
    return { state: next, effects };
  }

  if (isCommaHoldKey(e)) {
    if (!state.commaDown) return { state, effects: [] };
    const effects: MindHoldKeyEffect[] = [{ type: "preventDefault" }];
    const next = { ...state, commaDown: false };
    if (state.holdKind === "commaHyperfocus") {
      next.holdKind = "none";
      effects.push({ type: "endHold" });
    }
    return { state: next, effects };
  }

  return { state, effects: [] };
}

/**
 * Records a press-and-hold segment the same way SessionView finalizes an interval.
 * Used for unit tests and documents the persisted `mindStateLog` shape.
 */
export function recordHoldSegment(
  log: Array<{ time: number; state: string }>,
  segmentState: "thinking" | "hyperfocus",
  startTime: number,
  endTime: number,
): Array<{ time: number; state: string }> {
  return [
    ...log,
    { time: startTime, state: segmentState },
    { time: endTime, state: "clear" },
  ];
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

export type MindStateCompositionSeconds = {
  clearSeconds: number;
  lightDistractionSeconds: number;
  heavyDistractionSeconds: number;
  hyperfocusSeconds: number;
  totalSeconds: number;
};

function bucketMindStateSeconds(state: string, seconds: number, out: MindStateCompositionSeconds): void {
  if (seconds <= 0) return;
  switch (state) {
    case "thinking":
      out.lightDistractionSeconds += seconds;
      break;
    case "heavy":
      out.heavyDistractionSeconds += seconds;
      break;
    case "hyperfocus":
      out.hyperfocusSeconds += seconds;
      break;
    default:
      out.clearSeconds += seconds;
      break;
  }
}

function isValidMindStateLogEntry(
  entry: unknown,
): entry is { time: number; state: string } {
  return (
    entry != null
    && typeof entry === "object"
    && typeof (entry as { time?: unknown }).time === "number"
    && Number.isFinite((entry as { time: number }).time)
    && typeof (entry as { state?: unknown }).state === "string"
  );
}

/**
 * Replays `mindStateLog` into sit-time seconds for clear, light distraction,
 * heavy distraction, and hyperfocus. Uses the same segment boundaries as
 * `computeClearPercentFromLog`.
 */
export function computeMindStateCompositionFromLog(
  log: Array<{ time: number; state: string }>,
  endTime: number,
): MindStateCompositionSeconds {
  const totalSeconds = Math.max(endTime, 0);
  const out: MindStateCompositionSeconds = {
    clearSeconds: 0,
    lightDistractionSeconds: 0,
    heavyDistractionSeconds: 0,
    hyperfocusSeconds: 0,
    totalSeconds,
  };
  if (totalSeconds === 0) return out;

  const safeLog = [...log]
    .flatMap((entry) => {
      if (!isValidMindStateLogEntry(entry)) return [];
      return [{
        time: Math.min(Math.max(entry.time, 0), totalSeconds),
        state: entry.state,
      }];
    })
    .sort((a, b) => a.time - b.time);

  let lastTime = 0;
  let lastState = "clear";
  const full = safeLog.length === 0
    ? [{ time: totalSeconds, state: "clear" }]
    : [...safeLog, { time: totalSeconds, state: "clear" }];
  for (const entry of full) {
    const clampedTime = Math.min(Math.max(entry.time, lastTime), totalSeconds);
    if (clampedTime > lastTime) {
      bucketMindStateSeconds(lastState, clampedTime - lastTime, out);
    }
    lastTime = clampedTime;
    lastState = entry.state;
  }

  return out;
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
