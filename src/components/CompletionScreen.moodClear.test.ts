/** @vitest-environment jsdom */
/**
 * Issue #792 — the completion screen autosaves its mood matrix (#753), so
 * deselecting cells that were already saved has to delete the stored values.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearMock,
  pendingSaveMock,
  render,
  resetCompletionScreenHarness,
  saveMoodMatrixMock,
  settleAutosave,
  setUpCompletionScreenHarness,
  tapMoodCell,
  tapReturn,
} from "@/lib/testing/completionScreenHarness";

beforeEach(setUpCompletionScreenHarness);
afterEach(resetCompletionScreenHarness);

describe("CompletionScreen mood clear (#792)", () => {
  test("deselecting every mood cell clears the saved matrix", async () => {
    const onSaveMoodMatrix = saveMoodMatrixMock();
    const onClearMoodMatrix = clearMock();
    await render({ onSaveMoodMatrix, onClearMoodMatrix });

    await tapMoodCell("Calm before: 3");
    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenCalledWith({ calm: { before: 3, after: null } });

    await tapMoodCell("Calm before: 3");
    await settleAutosave();
    expect(onClearMoodMatrix).toHaveBeenCalledTimes(1);
    expect(onSaveMoodMatrix).toHaveBeenCalledTimes(1);
  });

  test("emptying one saved row sends an all-null row for it and keeps the others", async () => {
    const onSaveMoodMatrix = saveMoodMatrixMock();
    const onClearMoodMatrix = clearMock();
    await render({ onSaveMoodMatrix, onClearMoodMatrix });

    await tapMoodCell("Calm before: 3");
    await tapMoodCell("Focus after: 4");
    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenLastCalledWith({
      calm: { before: 3, after: null },
      focus: { before: null, after: 4 },
    });

    await tapMoodCell("Calm before: 3");
    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenLastCalledWith({
      calm: { before: null, after: null },
      focus: { before: null, after: 4 },
    });
    expect(onClearMoodMatrix).not.toHaveBeenCalled();
  });

  test("a mood deselected while its save is in flight is cleared once that save lands", async () => {
    const { save: onSaveMoodMatrix, finish: finishSave } = pendingSaveMock();
    const onClearMoodMatrix = clearMock();
    await render({ onSaveMoodMatrix, onClearMoodMatrix });

    await tapMoodCell("Energy after: 5");
    await settleAutosave();
    await tapMoodCell("Energy after: 5");
    await settleAutosave();
    expect(onClearMoodMatrix).not.toHaveBeenCalled();

    await finishSave();
    expect(onClearMoodMatrix).toHaveBeenCalledTimes(1);
  });

  test("a matrix never saved sends nothing when its cells are deselected", async () => {
    const onSaveMoodMatrix = saveMoodMatrixMock();
    const onClearMoodMatrix = clearMock();
    const onReturn = vi.fn();
    await render({ onSaveMoodMatrix, onClearMoodMatrix, onReturn });

    await tapMoodCell("Anxiety before: 2");
    await tapMoodCell("Anxiety before: 2");
    await tapReturn();

    expect(onSaveMoodMatrix).not.toHaveBeenCalled();
    expect(onClearMoodMatrix).not.toHaveBeenCalled();
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test("a mood deselected after its save failed is still cleared, since that save may have landed", async () => {
    const onSaveMoodMatrix = vi.fn<(matrix: Record<string, unknown>) => Promise<void>>()
      .mockRejectedValueOnce(new Error("response lost"));
    const onClearMoodMatrix = clearMock();
    await render({ onSaveMoodMatrix, onClearMoodMatrix });

    await tapMoodCell("Calm before: 3");
    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenCalledTimes(1);

    await tapMoodCell("Calm before: 3");
    await settleAutosave();
    expect(onClearMoodMatrix).toHaveBeenCalledTimes(1);
  });

  test("a row only a failed save carried is still emptied once it is deselected", async () => {
    const onSaveMoodMatrix = vi.fn<(matrix: Record<string, unknown>) => Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValue(undefined);
    const onClearMoodMatrix = clearMock();
    await render({ onSaveMoodMatrix, onClearMoodMatrix });

    await tapMoodCell("Calm before: 3");
    await settleAutosave();
    await tapMoodCell("Focus after: 4");
    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenCalledTimes(2);

    // Back to the last confirmed matrix, but the failed save may have stored focus.
    await tapMoodCell("Focus after: 4");
    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenCalledTimes(3);
    expect(onSaveMoodMatrix).toHaveBeenLastCalledWith({
      calm: { before: 3, after: null },
      focus: { before: null, after: null },
    });
    expect(onClearMoodMatrix).not.toHaveBeenCalled();
  });
});
