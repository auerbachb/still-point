/**
 * #680: the grid-tap focus game's pure rules, driven by a fake clock (explicit
 * `nowMs` values) and a seeded random source, so every run is deterministic.
 */
import { describe, expect, test } from "vitest";
import { FOCUS_GAME_CATEGORY, isFocusCategory, parseOptionalFocusCategory } from "./constants";
import { FOCUS_ACTIVITIES, focusSessionLabel } from "./focusActivityContent";
import {
  advanceFocusGame,
  createFocusGame,
  focusGameRemainingMs,
  FOCUS_GAME_COLUMNS,
  FOCUS_GAME_MAX_ROWS,
  FOCUS_GAME_MIN_ROWS,
  FOCUS_GAME_TIMING,
  isFocusGameFinished,
  nextGapMs,
  pickCell,
  rowsForHeight,
  tapFocusGameCell,
  type FocusGameState,
  type RandomSource,
} from "./focusGameLogic";

const CELLS = FOCUS_GAME_COLUMNS * FOCUS_GAME_MAX_ROWS;
const { responseMs, minGapMs, extraGapMaxMs } = FOCUS_GAME_TIMING;

/** mulberry32: a small seeded generator, returning values in [0, 1). */
function seededRng(seed: number): RandomSource {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Advances the clock until a square lights, returning the lit state and the time it lit. */
function runUntilLit(state: FocusGameState, startMs: number, rng: RandomSource) {
  let now = startMs;
  let current = state;
  for (let i = 0; i < 100_000; i += 1) {
    const result = advanceFocusGame(current, now, rng, CELLS);
    current = result.state;
    if (result.outcome === "lit") return { state: current, nowMs: now };
    now += 50;
  }
  throw new Error("no square lit");
}

describe("rowsForHeight", () => {
  test("fits as many 44px rows as the height allows, within the bounds", () => {
    expect(rowsForHeight(44 * 6)).toBe(6);
    expect(rowsForHeight(44 * 8)).toBe(FOCUS_GAME_MAX_ROWS);
    expect(rowsForHeight(10_000)).toBe(FOCUS_GAME_MAX_ROWS);
  });

  test("never drops below the minimum row count on a very short viewport", () => {
    expect(rowsForHeight(0)).toBe(FOCUS_GAME_MIN_ROWS);
    expect(rowsForHeight(100)).toBe(FOCUS_GAME_MIN_ROWS);
  });
});

describe("nextGapMs", () => {
  test("draws every gap from [minGapMs, minGapMs + extraGapMaxMs]", () => {
    const rng = seededRng(1);
    for (let i = 0; i < 500; i += 1) {
      const gap = nextGapMs(rng);
      expect(gap).toBeGreaterThanOrEqual(minGapMs);
      expect(gap).toBeLessThanOrEqual(minGapMs + extraGapMaxMs);
    }
  });

  test("spreads across the range, so gaps vary and can be long", () => {
    const rng = seededRng(2);
    const gaps = Array.from({ length: 2000 }, () => nextGapMs(rng));
    expect(Math.min(...gaps)).toBeLessThan(minGapMs + extraGapMaxMs * 0.05);
    expect(Math.max(...gaps)).toBeGreaterThan(minGapMs + extraGapMaxMs * 0.95);
  });
});

describe("pickCell", () => {
  test("stays within the grid and never repeats the excluded cell", () => {
    const rng = seededRng(3);
    for (let i = 0; i < 1000; i += 1) {
      const cell = pickCell(rng, CELLS, 5);
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(CELLS);
      expect(cell).not.toBe(5);
    }
  });

  test("is deterministic for a given seed", () => {
    const a = seededRng(42);
    const b = seededRng(42);
    const first = Array.from({ length: 20 }, () => pickCell(a, CELLS, null));
    const second = Array.from({ length: 20 }, () => pickCell(b, CELLS, null));
    expect(first).toEqual(second);
  });
});

describe("createFocusGame", () => {
  test("starts the countdown at the chosen duration, with nothing lit", () => {
    const state = createFocusGame(180, 1_000, seededRng(4));
    expect(state.goalMs).toBe(180_000);
    expect(state.countdownStartMs).toBe(1_000);
    expect(state.lit).toBeNull();
    expect(state.nextLightAtMs).toBeGreaterThanOrEqual(1_000 + minGapMs);
    expect(focusGameRemainingMs(state, 1_000)).toBe(180_000);
  });
});

describe("advanceFocusGame: lighting", () => {
  test("does not light a square before the first quiet gap has passed", () => {
    const rng = seededRng(5);
    const state = createFocusGame(300, 0, rng);
    const early = advanceFocusGame(state, state.nextLightAtMs - 1, rng, CELLS);
    expect(early.outcome).toBe("none");
    expect(early.state.lit).toBeNull();
  });

  test("lights exactly one square once the gap has passed", () => {
    const rng = seededRng(6);
    const state = createFocusGame(300, 0, rng);
    const lit = advanceFocusGame(state, state.nextLightAtMs, rng, CELLS);
    expect(lit.outcome).toBe("lit");
    expect(lit.state.lit).not.toBeNull();
    expect(lit.state.lit?.litAtMs).toBe(state.nextLightAtMs);
  });

  test("never lights anything once the countdown has run out", () => {
    const rng = seededRng(7);
    const state = createFocusGame(60, 0, rng);
    const afterEnd = advanceFocusGame(state, 60_000, rng, CELLS);
    expect(afterEnd.outcome).toBe("none");
    expect(afterEnd.state.lit).toBeNull();
  });
});

describe("tapFocusGameCell: hits", () => {
  test("tapping the lit square within the response window scores a hit and clears it", () => {
    const rng = seededRng(8);
    const { state: lit, nowMs } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const cell = lit.lit!.cell;
    const tapped = tapFocusGameCell(lit, cell, nowMs + responseMs, rng, CELLS);
    expect(tapped.outcome).toBe("hit");
    expect(tapped.state.hits).toBe(1);
    expect(tapped.state.streak).toBe(1);
    expect(tapped.state.bestStreak).toBe(1);
    expect(tapped.state.lit).toBeNull();
    expect(tapped.state.resets).toBe(0);
  });

  test("the next light waits at least minGapMs after a hit", () => {
    const rng = seededRng(9);
    const { state: lit, nowMs } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const tapTime = nowMs + 200;
    const hit = tapFocusGameCell(lit, lit.lit!.cell, tapTime, rng, CELLS);
    expect(hit.state.nextLightAtMs - tapTime).toBeGreaterThanOrEqual(minGapMs);
    expect(hit.state.nextLightAtMs - tapTime).toBeLessThanOrEqual(minGapMs + extraGapMaxMs);
  });

  test("the streak grows with each consecutive hit and best streak keeps the peak", () => {
    const rng = seededRng(10);
    let state = createFocusGame(600, 0, rng);
    let now = 0;
    for (let round = 0; round < 3; round += 1) {
      const lit = runUntilLit(state, now, rng);
      now = lit.nowMs;
      const hit = tapFocusGameCell(lit.state, lit.state.lit!.cell, now, rng, CELLS);
      state = hit.state;
      now += 10;
    }
    expect(state.hits).toBe(3);
    expect(state.streak).toBe(3);
    expect(state.bestStreak).toBe(3);
  });
});

describe("tapFocusGameCell: wrong taps", () => {
  test("a tap on an unlit square is counted but does not reset the countdown", () => {
    const rng = seededRng(11);
    const { state: lit, nowMs } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const other = (lit.lit!.cell + 1) % CELLS;
    const wrong = tapFocusGameCell(lit, other, nowMs + 100, rng, CELLS);
    expect(wrong.outcome).toBe("wrong");
    expect(wrong.state.wrongTaps).toBe(1);
    expect(wrong.state.resets).toBe(0);
    expect(wrong.state.countdownStartMs).toBe(0);
    // The lit square is still lit and can still be hit.
    expect(wrong.state.lit).toEqual(lit.lit);
  });

  test("a tap while nothing is lit is a wrong tap", () => {
    const rng = seededRng(12);
    const state = createFocusGame(300, 0, rng);
    const wrong = tapFocusGameCell(state, 0, 10, rng, CELLS);
    expect(wrong.outcome).toBe("wrong");
    expect(wrong.state.wrongTaps).toBe(1);
  });
});

describe("missed squares reset the countdown", () => {
  test("no tap within the response window restarts the countdown from the goal", () => {
    const rng = seededRng(13);
    const { state: lit, nowMs } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const missedAt = nowMs + responseMs + 1;
    const reset = advanceFocusGame(lit, missedAt, rng, CELLS);
    expect(reset.outcome).toBe("reset");
    expect(reset.state.resets).toBe(1);
    expect(reset.state.countdownStartMs).toBe(missedAt);
    expect(reset.state.lit).toBeNull();
    expect(focusGameRemainingMs(reset.state, missedAt)).toBe(300_000);
  });

  test("a miss breaks the streak but keeps the best", () => {
    const rng = seededRng(14);
    const first = runUntilLit(createFocusGame(600, 0, rng), 0, rng);
    const hit = tapFocusGameCell(first.state, first.state.lit!.cell, first.nowMs, rng, CELLS);
    const second = runUntilLit(hit.state, first.nowMs + 10, rng);
    const reset = advanceFocusGame(second.state, second.nowMs + responseMs + 1, rng, CELLS);
    expect(reset.state.streak).toBe(0);
    expect(reset.state.bestStreak).toBe(1);
  });

  test("tapping at exactly the response limit is still a hit", () => {
    const rng = seededRng(15);
    const { state: lit, nowMs } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const hit = tapFocusGameCell(lit, lit.lit!.cell, nowMs + responseMs, rng, CELLS);
    expect(hit.outcome).toBe("hit");
  });

  test("a tap one millisecond past the window resets instead of scoring", () => {
    const rng = seededRng(16);
    const { state: lit, nowMs } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const late = tapFocusGameCell(lit, lit.lit!.cell, nowMs + responseMs + 1, rng, CELLS);
    expect(late.outcome).toBe("reset");
    expect(late.state.hits).toBe(0);
    expect(late.state.resets).toBe(1);
  });
});

describe("countdown", () => {
  test("reads the goal at the start and zero once it has elapsed", () => {
    const state = createFocusGame(60, 1_000, seededRng(17));
    expect(focusGameRemainingMs(state, 1_000)).toBe(60_000);
    expect(focusGameRemainingMs(state, 31_000)).toBe(30_000);
    expect(focusGameRemainingMs(state, 61_000)).toBe(0);
    expect(focusGameRemainingMs(state, 90_000)).toBe(0);
    expect(isFocusGameFinished(state, 60_999)).toBe(false);
    expect(isFocusGameFinished(state, 61_000)).toBe(true);
  });

  test("a run of hits never pushes the countdown back", () => {
    const rng = seededRng(18);
    let state = createFocusGame(120, 0, rng);
    let now = 0;
    for (let round = 0; round < 5; round += 1) {
      const lit = runUntilLit(state, now, rng);
      now = lit.nowMs;
      state = tapFocusGameCell(lit.state, lit.state.lit!.cell, now, rng, CELLS).state;
    }
    expect(state.countdownStartMs).toBe(0);
    expect(focusGameRemainingMs(state, now)).toBe(120_000 - now);
  });

  test("reaching the goal finishes the game without counting as a reset", () => {
    const rng = seededRng(19);
    const state = createFocusGame(60, 0, rng);
    expect(isFocusGameFinished(state, 0)).toBe(false);
    const finished = advanceFocusGame(state, 60_000, rng, CELLS);
    expect(isFocusGameFinished(finished.state, 60_000)).toBe(true);
    expect(finished.state.resets).toBe(0);
  });
});

describe("the game's focus category (#680)", () => {
  test("is a saved focus category, but not a picker card", () => {
    expect(isFocusCategory(FOCUS_GAME_CATEGORY)).toBe(true);
    expect(FOCUS_ACTIVITIES.map(activity => activity.id)).not.toContain(FOCUS_GAME_CATEGORY);
  });

  test("labels its History rows as a focus game and parses when saved", () => {
    expect(focusSessionLabel(FOCUS_GAME_CATEGORY)).toBe("Focus · Game");
    expect(parseOptionalFocusCategory(FOCUS_GAME_CATEGORY)).toBe(FOCUS_GAME_CATEGORY);
  });
});
