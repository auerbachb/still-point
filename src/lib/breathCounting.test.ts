import { describe, expect, it } from "vitest";
import {
  breathCountForTaps,
  elapsedDisplay,
  elapsedSeconds,
  phaseForTaps,
} from "./breathCounting";

// Ports ios/StillPointShared/Tests/StillPointSharedTests/BreathCountingLogicTests.swift
// so the web breath-counting semantics stay locked to iOS (#374 → #376).

describe("breathCountForTaps", () => {
  it("is 0 for zero taps", () => {
    expect(breathCountForTaps(0)).toBe(0);
  });

  it("is 0 after one tap (inhale registered, no full breath yet)", () => {
    expect(breathCountForTaps(1)).toBe(0);
  });

  it("is 1 after two taps (inhale + exhale)", () => {
    expect(breathCountForTaps(2)).toBe(1);
  });

  it("is 2 after five taps (4 taps = 2 breaths + 1 pending inhale)", () => {
    expect(breathCountForTaps(5)).toBe(2);
  });

  it("is 5 for ten taps", () => {
    expect(breathCountForTaps(10)).toBe(5);
  });

  it("clamps negative taps to 0", () => {
    expect(breathCountForTaps(-4)).toBe(0);
  });
});

describe("phaseForTaps", () => {
  it("is inhale at zero taps (next action is inhale)", () => {
    expect(phaseForTaps(0)).toBe("inhale");
  });

  it("is exhale after one tap (inhale done → next is exhale)", () => {
    expect(phaseForTaps(1)).toBe("exhale");
  });

  it("is inhale after two taps (full breath done → next is inhale)", () => {
    expect(phaseForTaps(2)).toBe("inhale");
  });

  it("alternates: even = inhale, odd = exhale", () => {
    for (let taps = 0; taps <= 10; taps++) {
      const expected = taps % 2 === 0 ? "inhale" : "exhale";
      expect(phaseForTaps(taps)).toBe(expected);
    }
  });
});

describe("elapsedSeconds", () => {
  it("is 0 when start equals now", () => {
    const now = 1_000_000;
    expect(elapsedSeconds(now, now)).toBe(0);
  });

  it("is positive for a forward diff", () => {
    const start = 1_000_000;
    expect(elapsedSeconds(start, start + 65_000)).toBe(65);
  });

  it("clamps to 0 for a negative diff (now before start)", () => {
    const start = 1_000_000;
    expect(elapsedSeconds(start, start - 5_000)).toBe(0);
  });

  it("handles spans across a minute boundary", () => {
    const start = 1_000_000;
    expect(elapsedSeconds(start, start + 90_000)).toBe(90);
  });

  it("truncates rather than rounds (59.9s → 59)", () => {
    const start = 1_000_000;
    expect(elapsedSeconds(start, start + 59_900)).toBe(59);
  });
});

describe("elapsedDisplay", () => {
  it("formats zero", () => {
    expect(elapsedDisplay(0)).toBe("0:00");
  });

  it("formats one minute five seconds", () => {
    expect(elapsedDisplay(65)).toBe("1:05");
  });

  it("formats ten minutes", () => {
    expect(elapsedDisplay(600)).toBe("10:00");
  });

  it("zero-pads single-digit seconds", () => {
    expect(elapsedDisplay(9)).toBe("0:09");
  });

  it("formats one hour as 60:00", () => {
    expect(elapsedDisplay(3600)).toBe("60:00");
  });

  it("treats negative input as 0", () => {
    expect(elapsedDisplay(-5)).toBe("0:00");
  });
});
