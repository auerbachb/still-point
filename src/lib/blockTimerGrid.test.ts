/**
 * Issue #732 — the block grid a sit is drawn as.
 *
 * Sits over two minutes are minute blocks then a final minute in ten-second
 * blocks; shorter sits are ten-second blocks only. The minute-block index is
 * also what times the minute chime, so its cap matters as much as the drawing.
 * The digits' rounding is what the voice countdown speaks (#922).
 */
import { describe, expect, it } from "vitest";
import {
  buildBlocks,
  completedMinuteBlockIndex,
  countdownSeconds,
  minuteBlockCount,
  usesMinuteBlocks,
} from "./blockTimerGrid";

describe("usesMinuteBlocks", () => {
  it("starts minute blocks only past two minutes", () => {
    expect(usesMinuteBlocks(60)).toBe(false);
    expect(usesMinuteBlocks(120)).toBe(false);
    expect(usesMinuteBlocks(121)).toBe(true);
  });
});

describe("minuteBlockCount", () => {
  it("is zero for a short sit", () => {
    expect(minuteBlockCount(60)).toBe(0);
    expect(minuteBlockCount(120)).toBe(0);
  });

  it("leaves the last whole minute to the ten-second blocks", () => {
    expect(minuteBlockCount(180)).toBe(2);
    expect(minuteBlockCount(600)).toBe(9);
  });

  it("keeps every whole minute when a partial minute ends the sit", () => {
    expect(minuteBlockCount(121)).toBe(2);
    expect(minuteBlockCount(130)).toBe(2);
    expect(minuteBlockCount(725)).toBe(12);
  });
});

describe("buildBlocks", () => {
  it("draws a one-minute sit as six ten-second blocks", () => {
    expect(buildBlocks(60)).toEqual(
      [0, 10, 20, 30, 40, 50].map((startTime, i) => ({
        duration: 10,
        startTime,
        label: `${(i + 1) * 10}s`,
        type: "second",
      })),
    );
  });

  it("rounds a short sit's last partial block up to a whole block", () => {
    const blocks = buildBlocks(45);
    expect(blocks.map(b => b.label)).toEqual(["10s", "20s", "30s", "40s", "50s"]);
    expect(blocks.at(-1)).toMatchObject({ startTime: 40, duration: 10 });
  });

  it("draws a standard ten-minute sit as nine minutes then the final minute", () => {
    const blocks = buildBlocks(600);
    expect(blocks.filter(b => b.type === "minute").map(b => b.label)).toEqual(
      ["1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m"],
    );
    expect(blocks.filter(b => b.type === "second").map(b => b.startTime)).toEqual(
      [540, 550, 560, 570, 580, 590],
    );
  });

  it("gives a partial final minute only the ten-second blocks it needs", () => {
    expect(buildBlocks(130).map(b => b.label)).toEqual(["1m", "2m", "10s"]);
    expect(buildBlocks(725).filter(b => b.type === "second")).toEqual([
      { duration: 10, startTime: 720, label: "10s", type: "second" },
    ]);
  });

  it("tiles every sit from zero to its end with no gap or overlap", () => {
    for (let total = 1; total <= 900; total++) {
      const blocks = buildBlocks(total);
      expect(blocks[0].startTime).toBe(0);
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i].startTime).toBe(blocks[i - 1].startTime + blocks[i - 1].duration);
      }
      const last = blocks[blocks.length - 1];
      expect(last.startTime).toBeLessThan(total);
      expect(last.startTime + last.duration).toBeGreaterThanOrEqual(total);
    }
  });
});

describe("countdownSeconds", () => {
  it("rounds the time left up, as the iOS digits do", () => {
    expect(countdownSeconds(0, 600)).toBe(600);
    expect(countdownSeconds(0.05, 600)).toBe(600);
    expect(countdownSeconds(1, 600)).toBe(599);
    expect(countdownSeconds(1.003, 600)).toBe(599);
  });

  it("reads 60 through the whole first second of the final minute", () => {
    expect(countdownSeconds(539.97, 600)).toBe(61);
    expect(countdownSeconds(540, 600)).toBe(60);
    expect(countdownSeconds(540.97, 600)).toBe(60);
    expect(countdownSeconds(541, 600)).toBe(59);
  });

  it("reaches 0 only once the sit is over", () => {
    expect(countdownSeconds(599.99, 600)).toBe(1);
    expect(countdownSeconds(600, 600)).toBe(0);
    expect(countdownSeconds(605, 600)).toBe(0);
  });
});

describe("completedMinuteBlockIndex", () => {
  it("is -1 throughout a sit with no minute blocks", () => {
    expect(completedMinuteBlockIndex(0, 120)).toBe(-1);
    expect(completedMinuteBlockIndex(119, 120)).toBe(-1);
  });

  it("counts a minute block only once its minute has fully passed", () => {
    expect(completedMinuteBlockIndex(59.99, 600)).toBe(-1);
    expect(completedMinuteBlockIndex(60, 600)).toBe(0);
    expect(completedMinuteBlockIndex(179.99, 600)).toBe(1);
  });

  it("stops at the last minute block — the final minute is not one", () => {
    expect(completedMinuteBlockIndex(540, 600)).toBe(8);
    expect(completedMinuteBlockIndex(600, 600)).toBe(8);
    expect(completedMinuteBlockIndex(130, 130)).toBe(1);
  });
});
