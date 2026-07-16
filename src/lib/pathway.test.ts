import { describe, expect, test } from "vitest";
import {
  DAYS_PER_LEVEL,
  LEVEL_NAMES,
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
    const levels = buildPathway(1);
    expect(levels).toHaveLength(TOTAL_LEVELS);
    expect(levels.map((l) => l.name)).toEqual([...LEVEL_NAMES]);
    for (const level of levels) {
      expect(level.nodes).toHaveLength(DAYS_PER_LEVEL);
    }
  });

  test("node days are contiguous from 1..50", () => {
    const days = buildPathway(1).flatMap((l) => l.nodes.map((n) => n.day));
    expect(days).toEqual(Array.from({ length: PATHWAY_MAX_DAY }, (_, i) => i + 1));
  });

  test("day 1: first node current, rest locked", () => {
    const [first] = buildPathway(1);
    expect(first!.nodes[0]!.state).toBe("current");
    expect(first!.nodes.slice(1).every((n) => n.state === "locked")).toBe(true);
    expect(first!.completedCount).toBe(0);
    expect(first!.state).toBe("current");
  });

  test("mid-level currentDay marks completed/current/locked correctly", () => {
    // currentDay 13 → L1 fully complete, L2 has 2 completed + day 13 current
    const levels = buildPathway(13);
    const l1 = levels[0]!;
    const l2 = levels[1]!;
    expect(l1.state).toBe("completed");
    expect(l1.completedCount).toBe(DAYS_PER_LEVEL);
    expect(l1.nodes.every((n) => n.state === "completed")).toBe(true);

    expect(l2.state).toBe("current");
    expect(l2.completedCount).toBe(2);
    expect(l2.nodes[0]!.state).toBe("completed"); // day 11
    expect(l2.nodes[1]!.state).toBe("completed"); // day 12
    expect(l2.nodes[2]!.state).toBe("current"); // day 13
    expect(l2.nodes[3]!.state).toBe("locked"); // day 14
  });

  test("exactly one node is current within the pathway range", () => {
    const currents = buildPathway(27)
      .flatMap((l) => l.nodes)
      .filter((n) => n.state === "current");
    expect(currents).toHaveLength(1);
    expect(currents[0]!.day).toBe(27);
  });

  test("currentDay beyond the program completes every node", () => {
    const levels = buildPathway(PATHWAY_MAX_DAY + 5);
    const allNodes = levels.flatMap((l) => l.nodes);
    expect(allNodes.every((n) => n.state === "completed")).toBe(true);
    expect(levels.every((l) => l.state === "completed")).toBe(true);
  });

  test("currentDay exactly at the last day keeps it current", () => {
    const last = buildPathway(PATHWAY_MAX_DAY)[TOTAL_LEVELS - 1]!;
    expect(last.nodes[DAYS_PER_LEVEL - 1]!.state).toBe("current");
    expect(last.state).toBe("current");
  });

  test("clamps non-finite or sub-1 input to day 1", () => {
    for (const input of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const levels = buildPathway(input as number);
      if (input === Number.POSITIVE_INFINITY) {
        // Infinity is non-finite → clamped to 1
        expect(levels[0]!.nodes[0]!.state).toBe("current");
      } else {
        expect(levels[0]!.nodes[0]!.state).toBe("current");
      }
    }
  });

  // MARK: - Shared cross-platform fixtures (#421 / #525)

  test("shared pathway fixtures", () => {
    const fixture = loadSharedFixture<PathwayFixture>("pathway.json");

    expect(DAYS_PER_LEVEL).toBe(fixture.daysPerLevel);
    expect(TOTAL_LEVELS).toBe(fixture.totalLevels);
    expect(PATHWAY_MAX_DAY).toBe(fixture.pathwayMaxDay);
    expect([...LEVEL_NAMES]).toEqual(fixture.levelNames);

    for (const testCase of fixture.nodeStateForDay) {
      expect(nodeStateForDay(testCase.day, testCase.currentDay)).toBe(testCase.expected);
    }

    for (const testCase of fixture.buildPathway) {
      const levels = buildPathway(testCase.currentDay);

      if (testCase.expectedLevelCount != null) {
        expect(levels).toHaveLength(testCase.expectedLevelCount);
      }

      if (testCase.expectedAllDays != null) {
        const days = levels.flatMap((l) => l.nodes.map((n) => n.day));
        expect(days).toEqual(testCase.expectedAllDays);
      }

      if (testCase.expectedCurrentNodeCount != null) {
        const currents = levels.flatMap((l) => l.nodes).filter((n) => n.state === "current");
        expect(currents).toHaveLength(testCase.expectedCurrentNodeCount);
      }

      if (testCase.expectedCurrentNodeDay != null) {
        const currents = levels.flatMap((l) => l.nodes).filter((n) => n.state === "current");
        expect(currents[0]!.day).toBe(testCase.expectedCurrentNodeDay);
      }

      if (testCase.expectedAllNodesCompleted === true) {
        expect(levels.flatMap((l) => l.nodes).every((n) => n.state === "completed")).toBe(true);
      }

      if (testCase.expectedAllLevelsCompleted === true) {
        expect(levels.every((l) => l.state === "completed")).toBe(true);
      }

      if (testCase.expectedLastLevelState != null) {
        expect(levels[TOTAL_LEVELS - 1]!.state).toBe(testCase.expectedLastLevelState);
      }

      if (testCase.expectedLastNodeState != null) {
        expect(levels[TOTAL_LEVELS - 1]!.nodes[DAYS_PER_LEVEL - 1]!.state).toBe(
          testCase.expectedLastNodeState,
        );
      }

      if (testCase.expectedFirstNodeState != null) {
        expect(levels[0]!.nodes[0]!.state).toBe(testCase.expectedFirstNodeState);
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
