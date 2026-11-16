import { describe, expect, it } from "vitest";
import {
  advanceFocusGame,
  createFocusGame,
  FOCUS_GAME_COLUMNS,
  FOCUS_GAME_DEFAULT_DURATION_SECONDS,
  FOCUS_GAME_DURATIONS_SECONDS,
  FOCUS_GAME_GRID_GAP_PX,
  FOCUS_GAME_MAX_ROWS,
  FOCUS_GAME_MIN_ROWS,
  FOCUS_GAME_RESERVED_PX,
  FOCUS_GAME_TIMING,
  focusGameRemainingMs,
  focusGameResult,
  gridHeightPx,
  isFocusGameFinished,
  nextGapMs,
  pickCell,
  rowsForHeight,
  rowsForViewport,
  tapFocusGameCell,
  type FocusGameState,
  type RandomSource,
} from "./focusGameLogic";
import { loadSharedFixture } from "./testing/sharedFixtures";

/**
 * #1192: the golden fixture `shared/test-fixtures/focusGame.json` is also replayed by
 * the iOS suite (`FocusGameLogicTests.swift`). Each case feeds the recorded random
 * rolls in order, so both platforms consume the same draws and must agree on every
 * step's outcome, state and saved result.
 */

type SnapJSON = {
  goalMs: number;
  startedAtMs: number;
  countdownStartMs: number;
  lit: { cell: number; litAtMs: number } | null;
  nextLightAtMs: number;
  lastCell: number | null;
  hits: number;
  wrongTaps: number;
  resets: number;
  streak: number;
  bestStreak: number;
  remainingMs: number;
  finished: boolean;
};

type StepJSON = {
  op: "create" | "advance" | "tap" | "end";
  atMs: number;
  outcome?: string;
  cell?: number;
  reason?: "expired" | "ended";
  state?: SnapJSON;
  result: { duration: number; actualTime: number; completed: boolean } | null;
};

type CaseJSON = {
  name: string;
  goalSeconds: number;
  startMs: number;
  cells: number;
  rolls: number[];
  steps: StepJSON[];
};

type FixtureJSON = {
  timing: typeof FOCUS_GAME_TIMING;
  columns: number;
  maxRows: number;
  minRows: number;
  durationsSeconds: number[];
  defaultDurationSeconds: number;
  gridGapPx: number;
  reservedPx: number;
  rowsForViewport: { viewportPx: number; expected: number }[];
  rowsForHeight: { availablePx: number; expected: number }[];
  gridHeightPx: { rows: number; expected: number }[];
  nextGapMs: { roll: number; expected: number }[];
  pickCell: { cells: number; exclude: number | null; rolls: number[]; expected: number[] }[];
  cases: CaseJSON[];
};

const fixture = loadSharedFixture<FixtureJSON>("focusGame.json");

function rollSource(rolls: number[]): { next: RandomSource; consumed: () => number } {
  let index = 0;
  return {
    next: () => {
      if (index >= rolls.length) throw new Error(`recorded rolls exhausted at ${index}`);
      return rolls[index++];
    },
    consumed: () => index,
  };
}

function requireState(state: FocusGameState | null): FocusGameState {
  if (!state) throw new Error("no game state yet");
  return state;
}

function snapshot(state: FocusGameState, nowMs: number): SnapJSON {
  return {
    goalMs: state.goalMs,
    startedAtMs: state.startedAtMs,
    countdownStartMs: state.countdownStartMs,
    lit: state.lit ? { cell: state.lit.cell, litAtMs: state.lit.litAtMs } : null,
    nextLightAtMs: state.nextLightAtMs,
    lastCell: state.lastCell,
    hits: state.hits,
    wrongTaps: state.wrongTaps,
    resets: state.resets,
    streak: state.streak,
    bestStreak: state.bestStreak,
    remainingMs: focusGameRemainingMs(state, nowMs),
    finished: isFocusGameFinished(state, nowMs),
  };
}

describe("focus game shared fixture: constants and helpers", () => {
  it("timing and layout constants match the fixture", () => {
    expect(FOCUS_GAME_TIMING).toEqual(fixture.timing);
    expect(FOCUS_GAME_COLUMNS).toBe(fixture.columns);
    expect(FOCUS_GAME_MAX_ROWS).toBe(fixture.maxRows);
    expect(FOCUS_GAME_MIN_ROWS).toBe(fixture.minRows);
    expect([...FOCUS_GAME_DURATIONS_SECONDS]).toEqual(fixture.durationsSeconds);
    expect(FOCUS_GAME_DEFAULT_DURATION_SECONDS).toBe(fixture.defaultDurationSeconds);
    expect(FOCUS_GAME_GRID_GAP_PX).toBe(fixture.gridGapPx);
    expect(FOCUS_GAME_RESERVED_PX).toBe(fixture.reservedPx);
  });

  it("rows and grid heights match the fixture", () => {
    for (const row of fixture.rowsForViewport) {
      expect(rowsForViewport(row.viewportPx), `viewport ${row.viewportPx}`).toBe(row.expected);
    }
    for (const row of fixture.rowsForHeight) {
      expect(rowsForHeight(row.availablePx), `height ${row.availablePx}`).toBe(row.expected);
    }
    for (const row of fixture.gridHeightPx) {
      expect(gridHeightPx(row.rows), `rows ${row.rows}`).toBe(row.expected);
    }
  });

  it("next gap and pick cell match the fixture", () => {
    for (const row of fixture.nextGapMs) {
      expect(nextGapMs(() => row.roll), `roll ${row.roll}`).toBe(row.expected);
    }
    for (const row of fixture.pickCell) {
      const source = rollSource(row.rolls);
      const picked = row.rolls.map(() => pickCell(source.next, row.cells, row.exclude));
      expect(picked, `cells ${row.cells} exclude ${row.exclude}`).toEqual(row.expected);
    }
  });
});

describe("focus game shared fixture: golden replay", () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const source = rollSource(testCase.rolls);
      let state: FocusGameState | null = null;

      testCase.steps.forEach((step, index) => {
        const label = `step ${index} (${step.op})`;
        const nowMs = step.atMs;
        if (step.op === "create") {
          state = createFocusGame(testCase.goalSeconds, nowMs, source.next);
          expect(snapshot(state, nowMs), label).toEqual(step.state);
          return;
        }
        if (step.op === "advance") {
          const result = advanceFocusGame(requireState(state), nowMs, source.next, testCase.cells);
          expect(result.outcome, label).toBe(step.outcome);
          state = result.state;
          expect(snapshot(state, nowMs), label).toEqual(step.state);
          return;
        }
        if (step.op === "tap") {
          const result = tapFocusGameCell(requireState(state), step.cell ?? -1, nowMs, source.next, testCase.cells);
          expect(result.outcome, label).toBe(step.outcome);
          state = result.state;
          expect(snapshot(state, nowMs), label).toEqual(step.state);
          return;
        }
        const saved = focusGameResult(requireState(state), nowMs, step.reason ?? "ended");
        expect(saved ?? null, label).toEqual(step.result);
      });

      expect(source.consumed(), "every recorded roll consumed").toBe(testCase.rolls.length);
    });
  }
});
