/**
 * Issue #472 — before/after mood matrix.
 *
 * Unit tests for the helper functions in MoodMatrix.tsx:
 *   - isMoodMatrixTouched: detects whether any cell has been selected
 *   - buildMoodMatrixPayload: strips untouched rows before sending to the API
 */
import { describe, expect, test } from "vitest";
import {
  isMoodMatrixTouched,
  buildMoodMatrixPayload,
  MOOD_KEYS,
  type MoodMatrixValue,
} from "@/lib/moodMatrix";

describe("isMoodMatrixTouched", () => {
  test("returns false for an empty matrix", () => {
    expect(isMoodMatrixTouched({})).toBe(false);
  });

  test("returns false when all entries have null before and after", () => {
    const value: MoodMatrixValue = {
      calm: { before: null, after: null },
      focus: { before: null, after: null },
    };
    expect(isMoodMatrixTouched(value)).toBe(false);
  });

  test("returns true when any before value is set", () => {
    const value: MoodMatrixValue = {
      calm: { before: 3, after: null },
    };
    expect(isMoodMatrixTouched(value)).toBe(true);
  });

  test("returns true when any after value is set", () => {
    const value: MoodMatrixValue = {
      energy: { before: null, after: 5 },
    };
    expect(isMoodMatrixTouched(value)).toBe(true);
  });

  test("returns true when both before and after are set on a single row", () => {
    const value: MoodMatrixValue = {
      overall: { before: 2, after: 4 },
    };
    expect(isMoodMatrixTouched(value)).toBe(true);
  });

  test("returns true when multiple rows are fully set", () => {
    const value: MoodMatrixValue = {
      calm: { before: 1, after: 2 },
      focus: { before: 3, after: 4 },
      energy: { before: 2, after: 3 },
      anxiety: { before: 5, after: 2 },
      overall: { before: 3, after: 5 },
    };
    expect(isMoodMatrixTouched(value)).toBe(true);
  });
});

describe("buildMoodMatrixPayload", () => {
  test("returns an empty object for an empty matrix", () => {
    expect(buildMoodMatrixPayload({})).toEqual({});
  });

  test("strips rows where both before and after are null", () => {
    const value: MoodMatrixValue = {
      calm: { before: null, after: null },
      focus: { before: 3, after: 5 },
    };
    const result = buildMoodMatrixPayload(value);
    expect(result).not.toHaveProperty("calm");
    expect(result).toHaveProperty("focus", { before: 3, after: 5 });
  });

  test("keeps rows where only before is set", () => {
    const value: MoodMatrixValue = {
      energy: { before: 2, after: null },
    };
    const result = buildMoodMatrixPayload(value);
    expect(result).toHaveProperty("energy", { before: 2, after: null });
  });

  test("keeps rows where only after is set", () => {
    const value: MoodMatrixValue = {
      anxiety: { before: null, after: 1 },
    };
    const result = buildMoodMatrixPayload(value);
    expect(result).toHaveProperty("anxiety", { before: null, after: 1 });
  });

  test("includes all five moods when fully populated", () => {
    const value: MoodMatrixValue = {
      calm:    { before: 2, after: 4 },
      focus:   { before: 3, after: 5 },
      energy:  { before: 1, after: 3 },
      anxiety: { before: 4, after: 2 },
      overall: { before: 3, after: 5 },
    };
    const result = buildMoodMatrixPayload(value);
    expect(Object.keys(result)).toHaveLength(5);
    for (const key of MOOD_KEYS) {
      expect(result).toHaveProperty(key);
    }
  });

  test("does not include keys not present in the source object", () => {
    const value: MoodMatrixValue = {
      calm: { before: 3, after: 4 },
    };
    const result = buildMoodMatrixPayload(value);
    expect(Object.keys(result)).toEqual(["calm"]);
  });

  test("preserves null before/after rather than omitting them when the row is touched", () => {
    const value: MoodMatrixValue = {
      overall: { before: null, after: 5 },
    };
    const result = buildMoodMatrixPayload(value);
    expect(result.overall).toEqual({ before: null, after: 5 });
  });
});
