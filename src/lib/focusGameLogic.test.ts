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
  focusGameResult,
  FOCUS_GAME_COLUMNS,
  FOCUS_GAME_GRID_GAP_PX,
  FOCUS_GAME_MAX_ROWS,
  FOCUS_GAME_RESERVED_PX,
  gridHeightPx,
  rowsForViewport,
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

describe("rowsForViewport: short phones keep End on screen", () => {
  test("the grid and the reserved space together fit a 480px, 568px or 640px viewport", () => {
    for (const viewport of [480, 568, 640]) {
      const rows = rowsForViewport(viewport);
      expect(gridHeightPx(rows) + FOCUS_GAME_RESERVED_PX).toBeLessThanOrEqual(viewport);
    }
  });

  test("picks the row count the remaining height allows at each short height", () => {
    expect(rowsForViewport(480)).toBe(4);
    expect(rowsForViewport(568)).toBe(6);
    expect(rowsForViewport(640)).toBe(7);
  });

  test("below the minimum grid it keeps the minimum rows and the view scrolls, never shrinks targets", () => {
    expect(rowsForViewport(360)).toBe(FOCUS_GAME_MIN_ROWS);
    expect(gridHeightPx(FOCUS_GAME_MIN_ROWS) + FOCUS_GAME_RESERVED_PX).toBeGreaterThan(360);
  });
});

describe("rowsForHeight", () => {
  test("fits as many 44px rows as the height allows, within the bounds", () => {
    // n rows need n * 44 + (n - 1) * 8 px, so the grid gaps count toward the fit.
    expect(rowsForHeight(6 * 44 + 5 * 8)).toBe(6);
    expect(rowsForHeight(6 * 44 + 5 * 8 - 1)).toBe(5);
    expect(rowsForHeight(8 * 44 + 7 * 8)).toBe(FOCUS_GAME_MAX_ROWS);
    expect(rowsForHeight(10_000)).toBe(FOCUS_GAME_MAX_ROWS);
  });

  test("never picks a row count whose rows and gaps overflow the grid", () => {
    for (let px = 0; px <= 600; px += 1) {
      const rows = rowsForHeight(px);
      if (rows > FOCUS_GAME_MIN_ROWS) {
        expect(rows * 44 + (rows - 1) * FOCUS_GAME_GRID_GAP_PX).toBeLessThanOrEqual(px);
      }
    }
  });

  test("a 640px viewport keeps the End button clear: seven rows, not eight", () => {
    // The view reserves 260px above and below the grid, so a 640px viewport leaves 380px
    // minus the reserved space: 358px for the grid. Eight rows need 408px; seven need 356px.
    expect(rowsForHeight(358)).toBe(7);
    expect(rowsForHeight(408)).toBe(8);
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

  test("completion wins over a late miss: a resumed tab does not restart an expired game", () => {
    const rng = seededRng(20);
    const { state: lit } = runUntilLit(createFocusGame(60, 0, rng), 0, rng);
    const late = advanceFocusGame(lit, 60_000 + responseMs * 5, rng, CELLS);
    expect(late.outcome).toBe("none");
    expect(late.state).toEqual(lit);
    expect(isFocusGameFinished(late.state, 60_000 + responseMs * 5)).toBe(true);
  });

  test("a tap after the goal has elapsed does not restart an expired game", () => {
    const rng = seededRng(21);
    const { state: lit } = runUntilLit(createFocusGame(60, 0, rng), 0, rng);
    const late = tapFocusGameCell(lit, lit.lit!.cell, 60_000 + responseMs * 5, rng, CELLS);
    expect(late.outcome).toBe("none");
    expect(late.state.resets).toBe(0);
    expect(isFocusGameFinished(late.state, 60_000 + responseMs * 5)).toBe(true);
  });
});

describe("focusGameResult: what a game saves", () => {
  test("counts the whole game across resets, not only the last countdown run", () => {
    const rng = seededRng(22);
    const { state: lit, nowMs: litAt } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const missed = advanceFocusGame(lit, litAt + responseMs + 1, rng, CELLS);
    expect(missed.outcome).toBe("reset");
    const endedAt = missed.state.countdownStartMs + 400;
    // The last run only started 400ms ago, but the game has run since time zero.
    expect(focusGameResult(missed.state, endedAt, "ended")).toEqual({
      duration: 300,
      actualTime: Math.floor(endedAt / 1000),
      completed: false,
    });
  });

  test("a quick exit after a miss still saves, unlike the last countdown run alone", () => {
    const rng = seededRng(23);
    const { state: lit, nowMs: litAt } = runUntilLit(createFocusGame(300, 0, rng), 0, rng);
    const missed = advanceFocusGame(lit, litAt + responseMs + 1, rng, CELLS);
    expect(focusGameResult(missed.state, missed.state.countdownStartMs + 100, "ended")).not.toBeNull();
  });

  test("nothing to save when the game ends inside its first second", () => {
    const state = createFocusGame(300, 5_000, seededRng(24));
    expect(focusGameResult(state, 5_900, "ended")).toBeNull();
  });

  test("an early end with the countdown still running is not completed", () => {
    const state = createFocusGame(60, 0, seededRng(25));
    expect(focusGameResult(state, 30_000, "ended")).toEqual({ duration: 60, actualTime: 30, completed: false });
  });

  test("time played is capped at the goal", () => {
    const state = createFocusGame(60, 0, seededRng(28));
    expect(focusGameResult(state, 200_000, "ended")?.actualTime).toBe(60);
  });

  test("End pressed at goal plus 1ms, before any tick, still saves a completed game", () => {
    const state = createFocusGame(60, 0, seededRng(27));
    expect(focusGameResult(state, 60_001, "ended")).toEqual({ duration: 60, actualTime: 60, completed: true });
  });

  test("a countdown that ran out is always completed", () => {
    const state = createFocusGame(180, 0, seededRng(26));
    expect(focusGameResult(state, 180_000, "expired")).toEqual({ duration: 180, actualTime: 180, completed: true });
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
