/**
 * Issue #472 — before/after mood matrix.
 *
 * Unit tests for the helper functions in @/lib/moodMatrix:
 *   - isMoodMatrixTouched: detects whether any cell has been selected
 *   - buildMoodMatrixPayload: strips untouched rows before sending to the API
 *   - buildMoodMatrixPatch: clears or deletes rows the user emptied (#792)
 *   - MOOD_KEYS / MOOD_LABELS: row order and labels, shared with iOS (#885)
 */
import { describe, expect, test } from "vitest";
import {
  isMoodMatrixTouched,
  buildMoodMatrixPayload,
  buildMoodMatrixPatch,
  MOOD_KEYS,
  MOOD_LABELS,
  type MoodMatrixValue,
} from "@/lib/moodMatrix";

describe("MOOD_KEYS (#885)", () => {
  test("puts Happiness just above Overall, in the order iOS MoodKey uses", () => {
    expect(MOOD_KEYS).toEqual(["calm", "focus", "energy", "anxiety", "happiness", "overall"]);
    expect(MOOD_LABELS.happiness).toBe("Happiness");
  });
});

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

  test("includes every mood when fully populated", () => {
    const value: MoodMatrixValue = Object.fromEntries(
      MOOD_KEYS.map((key, i) => [key, { before: (i % 5) + 1, after: ((i + 2) % 5) + 1 }]),
    );
    const result = buildMoodMatrixPayload(value);
    expect(Object.keys(result)).toHaveLength(MOOD_KEYS.length);
    for (const key of MOOD_KEYS) {
      expect(result).toHaveProperty(key, value[key]);
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

describe("buildMoodMatrixPatch (#792)", () => {
  test("returns null — clear the stored matrix — once every cell is deselected", () => {
    const current: MoodMatrixValue = {
      calm: { before: null, after: null },
      focus: { before: null, after: null },
    };
    expect(buildMoodMatrixPatch(current, { calm: { before: 2, after: 4 } })).toBeNull();
  });

  test("sends an all-null row for a stored row the user emptied", () => {
    const current: MoodMatrixValue = {
      calm: { before: null, after: null },
      focus: { before: 3, after: 5 },
    };
    const persisted = {
      calm: { before: 2, after: 4 },
      focus: { before: 3, after: 4 },
    };
    expect(buildMoodMatrixPatch(current, persisted)).toEqual({
      calm: { before: null, after: null },
      focus: { before: 3, after: 5 },
    });
  });

  test("sends an all-null happiness row once the stored one is emptied (#885)", () => {
    const current: MoodMatrixValue = {
      happiness: { before: null, after: null },
      overall: { before: 2, after: 4 },
    };
    const persisted = {
      happiness: { before: 3, after: 5 },
      overall: { before: 2, after: 4 },
    };
    expect(buildMoodMatrixPatch(current, persisted)).toEqual({
      happiness: { before: null, after: null },
      overall: { before: 2, after: 4 },
    });
  });

  test("leaves out rows that were never stored", () => {
    const current: MoodMatrixValue = {
      energy: { before: null, after: null },
      overall: { before: 1, after: 2 },
    };
    expect(buildMoodMatrixPatch(current, {})).toEqual({ overall: { before: 1, after: 2 } });
  });

  test("matches buildMoodMatrixPayload when nothing stored was emptied", () => {
    const current: MoodMatrixValue = {
      calm: { before: 2, after: 4 },
      anxiety: { before: 5, after: null },
    };
    expect(buildMoodMatrixPatch(current, { calm: { before: 1, after: 1 } }))
      .toEqual(buildMoodMatrixPayload(current));
  });
});
