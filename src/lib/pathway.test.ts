import { describe, expect, test } from "vitest";
import {
  DAYS_PER_LEVEL,
  LEVEL_NAMES,
  PATHWAY_COMING_SOON_MESSAGE,
  PATHWAY_MAX_DAY,
  TOTAL_LEVELS,
  buildPathway,
  nodeStateForDay,
} from "./pathway";
import { loadSharedFixture, type PathwayFixture } from "./testing/sharedFixtures";

describe("nodeStateForDay", () => {
  test("days before currentDay are completed", () => {
    expect(nodeStateForDay(1, 5)).toBe("completed");
    expect(nodeStateForDay(4, 5)).toBe("completed");
  });

  test("the currentDay node is current", () => {
    expect(nodeStateForDay(5, 5)).toBe("current");
  });

  test("days after currentDay are locked", () => {
    expect(nodeStateForDay(6, 5)).toBe("locked");
    expect(nodeStateForDay(50, 5)).toBe("locked");
  });
});

describe("buildPathway", () => {
  test("produces five named levels with ten nodes each", () => {
    const levels = buildPathway();
    expect(levels).toHaveLength(TOTAL_LEVELS);
    expect(levels.map((l) => l.name)).toEqual([...LEVEL_NAMES]);
    for (const level of levels) {
      expect(level.nodes).toHaveLength(DAYS_PER_LEVEL);
    }
  });

  test("node days are contiguous from 1..50", () => {
    const days = buildPathway().flatMap((l) => l.nodes.map((n) => n.day));
    expect(days).toEqual(Array.from({ length: PATHWAY_MAX_DAY }, (_, i) => i + 1));
  });

  test("does not derive completed or current nodes from day count (#587)", () => {
    const levels = buildPathway();
    const allNodes = levels.flatMap((l) => l.nodes);
    expect(allNodes.every((n) => n.state === "comingSoon")).toBe(true);
    expect(levels.every((l) => l.state === "comingSoon")).toBe(true);
    expect(levels.every((l) => l.completedCount === 0)).toBe(true);
    expect(allNodes.some((n) => n.state === "completed")).toBe(false);
    expect(allNodes.some((n) => n.state === "current")).toBe(false);
  });

  test("exposes coming-soon copy for tap affordance", () => {
    expect(PATHWAY_COMING_SOON_MESSAGE).toBe("Lessons coming soon");
  });

  // MARK: - Shared cross-platform fixtures (#421 / #525 / #587)

  test("shared pathway fixtures", () => {
    const fixture = loadSharedFixture<PathwayFixture>("pathway.json");

    expect(DAYS_PER_LEVEL).toBe(fixture.daysPerLevel);
    expect(TOTAL_LEVELS).toBe(fixture.totalLevels);
    expect(PATHWAY_MAX_DAY).toBe(fixture.pathwayMaxDay);
    expect([...LEVEL_NAMES]).toEqual(fixture.levelNames);
    expect(PATHWAY_COMING_SOON_MESSAGE).toBe(fixture.comingSoonMessage);

    for (const testCase of fixture.nodeStateForDay) {
      expect(nodeStateForDay(testCase.day, testCase.currentDay)).toBe(testCase.expected);
    }

    for (const testCase of fixture.buildPathway) {
      const levels = buildPathway();

      if (testCase.expectedLevelCount != null) {
        expect(levels).toHaveLength(testCase.expectedLevelCount);
      }

      if (testCase.expectedAllDays != null) {
        const days = levels.flatMap((l) => l.nodes.map((n) => n.day));
        expect(days).toEqual(testCase.expectedAllDays);
      }

      if (testCase.expectedAllNodesComingSoon === true) {
        expect(levels.flatMap((l) => l.nodes).every((n) => n.state === "comingSoon")).toBe(true);
      }

      if (testCase.expectedAllLevelsComingSoon === true) {
        expect(levels.every((l) => l.state === "comingSoon")).toBe(true);
      }

      if (testCase.expectedAllCompletedCountsZero === true) {
        expect(levels.every((l) => l.completedCount === 0)).toBe(true);
      }

      for (const expectedLevel of testCase.expectedLevels ?? []) {
        const level = levels[expectedLevel.level - 1]!;
        expect(level.name).toBe(expectedLevel.name);
        expect(level.state).toBe(expectedLevel.state);
        expect(level.completedCount).toBe(expectedLevel.completedCount);
        if (expectedLevel.firstNodeState != null) {
          expect(level.nodes[0]!.state).toBe(expectedLevel.firstNodeState);
        }
        if (expectedLevel.lastNodeState != null) {
          expect(level.nodes[DAYS_PER_LEVEL - 1]!.state).toBe(expectedLevel.lastNodeState);
        }
        if (expectedLevel.nodeStates != null) {
          expect(level.nodes.map((n) => n.state)).toEqual(expectedLevel.nodeStates);
        }
      }
    }
  });
});
