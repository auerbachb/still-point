// Pure grid-tap focus game (#680, web v1). No timers, DOM or React: `FocusGamesView`
// owns the wall clock and the random source and calls into these with timestamps,
// so every timing and reset rule stays unit-testable with a fake clock and a seeded RNG.
//
// The rules: a countdown runs for the chosen duration. Squares in a grid light up at
// random, one at a time, with a minimum quiet gap between lights. Tapping the lit
// square scores a hit. If the lit square is not tapped within the response window
// the countdown starts over. A tap on any other square is a wrong tap: it is counted
// and changes nothing else in v1.
/** Grid width; the grid is always this many columns wide. */
export const FOCUS_GAME_COLUMNS = 3;
/** Rows on a tall viewport. Short viewports get fewer (`rowsForHeight`). */
export const FOCUS_GAME_MAX_ROWS = 8;
export const FOCUS_GAME_MIN_ROWS = 4;

/** Timing rules, in milliseconds. The single place to tune the game's difficulty. */
export const FOCUS_GAME_TIMING = {
  /** A lit square must be tapped within this long after it lights, or the countdown resets. */
  responseMs: 1000,
  /** Minimum quiet time between one resolved light (hit or reset) and the next. Keeps
   *  this an attention game rather than a speed game. */
  minGapMs: 2000,
  /** Extra random quiet time on top of `minGapMs`, drawn uniformly. Gaps vary and can be long. */
  extraGapMaxMs: 6000,
} as const;

/** The durations the start screen offers, in seconds. */
export const FOCUS_GAME_DURATIONS_SECONDS = [60, 180, 300, 600] as const;
export const FOCUS_GAME_DEFAULT_DURATION_SECONDS = 300;

/** A random source in [0, 1). `Math.random` in the app, a seeded generator in tests. */
export type RandomSource = () => number;

export type FocusGameState = {
  /** The chosen duration. */
  goalMs: number;
  /** When the current countdown run started: the start, or the last reset. */
  countdownStartMs: number;
  /** The lit square, or null between lights. */
  lit: { cell: number; litAtMs: number } | null;
  /** The earliest moment the next square may light. Only read while nothing is lit. */
  nextLightAtMs: number;
  /** The square that lit last, so the same square never lights twice in a row. */
  lastCell: number | null;
  hits: number;
  wrongTaps: number;
  resets: number;
  /** Consecutive hits since the last reset. */
  streak: number;
  bestStreak: number;
};

/** What a call to `advanceFocusGame` or `tapFocusGameCell` did, for the view to show. */
export type FocusGameOutcome = "none" | "lit" | "hit" | "wrong" | "reset";

/** Rows that fit a given height, clamped to [FOCUS_GAME_MIN_ROWS, FOCUS_GAME_MAX_ROWS].
 *  `cellPx` is the minimum tap target, so a shorter viewport gets fewer rows, not smaller targets. */
export function rowsForHeight(availablePx: number, cellPx = 44): number {
  const fit = Math.floor(Math.max(0, availablePx) / cellPx);
  return Math.min(FOCUS_GAME_MAX_ROWS, Math.max(FOCUS_GAME_MIN_ROWS, fit));
}

/** Quiet time before the next light, drawn from [minGapMs, minGapMs + extraGapMaxMs]. */
export function nextGapMs(rng: RandomSource): number {
  const { minGapMs, extraGapMaxMs } = FOCUS_GAME_TIMING;
  return minGapMs + Math.floor(rng() * (extraGapMaxMs + 1));
}

/** A square to light: uniform over `cells`, never `exclude` (the square that lit last). */
export function pickCell(rng: RandomSource, cells: number, exclude: number | null): number {
  const pool: number[] = [];
  for (let cell = 0; cell < cells; cell += 1) {
    if (cell !== exclude) pool.push(cell);
  }
  if (pool.length === 0) return 0;
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
}

/** A fresh game: the countdown starts now, and the first light is one quiet gap away. */
export function createFocusGame(
  goalSeconds: number,
  nowMs: number,
  rng: RandomSource,
): FocusGameState {
  return {
    goalMs: goalSeconds * 1000,
    countdownStartMs: nowMs,
    lit: null,
    nextLightAtMs: nowMs + nextGapMs(rng),
    lastCell: null,
    hits: 0,
    wrongTaps: 0,
    resets: 0,
    streak: 0,
    bestStreak: 0,
  };
}

/** Whole milliseconds left on the countdown. Reads 0 once the goal has elapsed. */
export function focusGameRemainingMs(state: FocusGameState, nowMs: number): number {
  return Math.max(0, state.goalMs - (nowMs - state.countdownStartMs));
}

/** True once the countdown has run out. No square lights after this. */
export function isFocusGameFinished(state: FocusGameState, nowMs: number): boolean {
  return focusGameRemainingMs(state, nowMs) === 0;
}

/** The lit square's response window has passed without a tap: the countdown starts over. */
function expired(state: FocusGameState, nowMs: number): boolean {
  return state.lit !== null && nowMs - state.lit.litAtMs > FOCUS_GAME_TIMING.responseMs;
}

/** Applies a missed square: clears it, restarts the countdown, breaks the streak. */
function resetCountdown(state: FocusGameState, nowMs: number, rng: RandomSource): FocusGameState {
  return {
    ...state,
    lit: null,
    countdownStartMs: nowMs,
    resets: state.resets + 1,
    streak: 0,
    nextLightAtMs: nowMs + nextGapMs(rng),
  };
}

/**
 * Moves the game to `nowMs` without a tap. Call it on every tick. It either resets
 * the countdown (the lit square was missed), lights a new square (the quiet gap has
 * passed and the countdown is still running), or changes nothing.
 */
export function advanceFocusGame(
  state: FocusGameState,
  nowMs: number,
  rng: RandomSource,
  cells: number,
): { state: FocusGameState; outcome: FocusGameOutcome } {
  if (expired(state, nowMs)) {
    return { state: resetCountdown(state, nowMs, rng), outcome: "reset" };
  }
  if (state.lit === null && nowMs >= state.nextLightAtMs && focusGameRemainingMs(state, nowMs) > 0) {
    const cell = pickCell(rng, cells, state.lastCell);
    return {
      state: { ...state, lit: { cell, litAtMs: nowMs }, lastCell: cell },
      outcome: "lit",
    };
  }
  return { state, outcome: "none" };
}

/**
 * A tap on `cell` at `nowMs`. A lit square that has already expired is handled first,
 * as a reset, so a tap that lands between ticks cannot rescue a missed square. Then:
 * the lit square is a hit; any other square is a wrong tap, which counts but does not reset.
 */
export function tapFocusGameCell(
  state: FocusGameState,
  cell: number,
  nowMs: number,
  rng: RandomSource,
  cells: number,
): { state: FocusGameState; outcome: FocusGameOutcome } {
  if (expired(state, nowMs)) {
    return { state: resetCountdown(state, nowMs, rng), outcome: "reset" };
  }
  if (state.lit === null || state.lit.cell !== cell) {
    return { state: { ...state, wrongTaps: state.wrongTaps + 1 }, outcome: "wrong" };
  }
  const streak = state.streak + 1;
  return {
    state: {
      ...state,
      lit: null,
      hits: state.hits + 1,
      streak,
      bestStreak: Math.max(state.bestStreak, streak),
      nextLightAtMs: nowMs + nextGapMs(rng),
    },
    outcome: "hit",
  };
}

