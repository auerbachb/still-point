import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loader for the cross-platform golden fixtures in `shared/test-fixtures/`
 * (#421). The same JSON files are consumed by the iOS `swift test` suite via
 * `SharedFixtures.swift`, so web + iOS assert against one source of truth and
 * any drift between the duplicated algorithms breaks CI.
 */
const FIXTURES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "shared",
  "test-fixtures",
);

export function loadSharedFixture<T>(fileName: string): T {
  const raw = readFileSync(join(FIXTURES_DIR, fileName), "utf8");
  return JSON.parse(raw) as T;
}

// MARK: - Fixture shapes (mirror shared/test-fixtures/*.json)

export type ClearPercentFixture = {
  cases: Array<{
    name: string;
    log: Array<{ time: number; state: string }>;
    endTime: number;
    expected: number;
  }>;
};

export type HistoryJourneyFixture = {
  collapseGapThresholdDays: number;
  cases: Array<{
    name: string;
    todayIsoDate: string | null;
    sessions: Array<{
      id: string;
      sessionType: string;
      sessionDate: string;
      createdAt: string;
    }>;
    expectedRows: Array<
      | { kind: "missed"; date: string }
      | { kind: "missedRange"; startDate: string; endDate: string; dayCount: number }
      | { kind: "session"; id: string; sessionIndexInDay: number }
    >;
  }>;
};

export type SessionStatsFixture = {
  cases: Array<{
    name: string;
    sessions: Array<{
      id: string;
      sessionType: string;
      dayNumber: number;
      duration: number;
      bonusSeconds: number;
      actualTime: number;
      completed: boolean;
      clearPercent: number;
      thoughtCount: number;
      sessionDate: string;
    }>;
    expected: {
      streak: number;
      avgClearPercent: number;
      avgThoughtsPerSession: number;
      avgThoughtsPerMinute: number;
      bonusSecondsTotal: number;
      bonusMinutesTotal: number;
    };
  }>;
};

export type BreathCountingFixture = {
  breathCount: Array<{ taps: number; expected: number }>;
  phase: Array<{ taps: number; expected: "inhale" | "exhale" }>;
  elapsedDisplay: Array<{ seconds: number; expected: string }>;
};

export type AphorismsFixture = {
  expectedCount: number;
  cases: Array<{ day: number; expectedIndex: number }>;
};

export type BuddyCalendarColorsFixture = {
  paletteLength: number;
  palette: string[];
  cases: Array<{ userId: string; expectedIndex: number; expectedHex: string }>;
};

export type PathwayFixture = {
  daysPerLevel: number;
  totalLevels: number;
  pathwayMaxDay: number;
  levelNames: string[];
  comingSoonMessage: string;
  nodeStateForDay: Array<{ day: number; currentDay: number; expected: "completed" | "current" | "locked" }>;
  buildPathway: Array<{
    name: string;
    expectedLevelCount?: number;
    expectedAllDays?: number[];
    expectedAllNodesComingSoon?: boolean;
    expectedAllLevelsComingSoon?: boolean;
    expectedAllCompletedCountsZero?: boolean;
    expectedLevels?: Array<{
      level: number;
      name: string;
      state: "completed" | "current" | "locked" | "comingSoon";
      completedCount: number;
      firstNodeState?: "completed" | "current" | "locked" | "comingSoon";
      lastNodeState?: "completed" | "current" | "locked" | "comingSoon";
      nodeStates?: Array<"completed" | "current" | "locked" | "comingSoon">;
    }>;
  }>;
};

export type DurationForDayFixture = {
  constants: {
    baseDuration: number;
    increment: number;
    maxDuration: number;
    forkDay: number;
    recoveryMaxSteps: number;
    missedDayGapThreshold: number;
  };
  durationForDay: Array<{ day: number; expected: number }>;
  isDualTrackEligible: Array<{ currentDay: number; expected: boolean }>;
  advanceProgression: Array<{
    name: string;
    sessionType: "standard" | "quick" | "breath";
    completed: boolean;
    state: {
      currentDay: number;
      recoveryTargetDay: number | null;
      recoveryCurrentStep: number | null;
      recoveryTotalSteps: number | null;
    };
    expected: {
      currentDay: number;
      recoveryTargetDay: number | null;
      recoveryCurrentStep: number | null;
      recoveryTotalSteps: number | null;
    };
  }>;
  detectMissedDayGap: Array<{
    name: string;
    lastCompletedSessionDate: string | null;
    todayIso: string;
    currentDay: number;
    recovery: {
      recoveryTargetDay: number | null;
      recoveryCurrentStep: number | null;
      recoveryTotalSteps: number | null;
    };
    expected: {
      recoveryTargetDay: number;
      recoveryCurrentStep: number;
      recoveryTotalSteps: number;
    } | null;
  }>;
};
