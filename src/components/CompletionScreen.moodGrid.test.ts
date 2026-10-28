/** @vitest-environment jsdom */
/** Issue #885 — the Mood Shift grid's rows, layout, and the Happiness row. */
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { MOOD_KEYS, MOOD_LABELS } from "@/lib/moodMatrix";
import {
  clearMock,
  moodCell,
  render,
  resetCompletionScreenHarness,
  saveMoodMatrixMock,
  screen,
  settleAutosave,
  setUpCompletionScreenHarness,
  tapMoodCell,
} from "@/lib/testing/completionScreenHarness";

beforeEach(setUpCompletionScreenHarness);
afterEach(resetCompletionScreenHarness);

describe("CompletionScreen mood matrix Happiness row (#885)", () => {
  test("renders one row per mood key, with Happiness just above Overall", async () => {
    await render({ onSaveMoodMatrix: saveMoodMatrixMock() });

    const rowLabels = [...screen().querySelectorAll('button[aria-label$=" before: 1"]')]
      .map((cell) => cell.getAttribute("aria-label")!.replace(" before: 1", ""));
    expect(rowLabels).toEqual(MOOD_KEYS.map((key) => MOOD_LABELS[key]));
    expect(rowLabels.slice(-2)).toEqual(["Happiness", "Overall"]);

    // The whole word, kept to one line (the row's grid div shares the text).
    const happinessLabel = [...screen().querySelectorAll("div")]
      .find((el) => el.childElementCount === 0 && el.textContent === "Happiness");
    expect(happinessLabel?.style.whiteSpace).toBe("nowrap");
  });

  test("the column headers, scale hints and every row share one column template", async () => {
    await render({ onSaveMoodMatrix: saveMoodMatrixMock() });

    const grids = [...screen().querySelectorAll("div")].filter((el) => el.style.display === "grid");
    expect(grids).toHaveLength(MOOD_KEYS.length + 2);
    expect(new Set(grids.map((grid) => grid.style.gridTemplateColumns)).size).toBe(1);
  });

  test("Happiness before/after picks autosave like the other rows", async () => {
    const onSaveMoodMatrix = saveMoodMatrixMock();
    const onClearMoodMatrix = clearMock();
    await render({ onSaveMoodMatrix, onClearMoodMatrix });

    await tapMoodCell("Happiness before: 2");
    await tapMoodCell("Happiness after: 4");
    expect(moodCell("Happiness before: 2").getAttribute("aria-pressed")).toBe("true");
    expect(moodCell("Happiness after: 4").getAttribute("aria-pressed")).toBe("true");

    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenCalledTimes(1);
    expect(onSaveMoodMatrix).toHaveBeenCalledWith({ happiness: { before: 2, after: 4 } });
    expect(onClearMoodMatrix).not.toHaveBeenCalled();
  });
});
