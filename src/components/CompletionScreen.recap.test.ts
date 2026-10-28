/** @vitest-environment jsdom */
/**
 * Issue #889 — the recap without session ratings: its layout, autosave, and the
 * save-and-return flow, including the second tap that leaves after a failed
 * flush (#947).
 */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearMock,
  type CompletionScreenProps,
  flushWrites,
  moodCell,
  render,
  resetCompletionScreenHarness,
  returnButton,
  saveMoodMatrixMock,
  saveNoteMock,
  screen,
  settleAutosave,
  setUpCompletionScreenHarness,
  tapMoodCell,
  tapReturn,
  typeNote,
} from "@/lib/testing/completionScreenHarness";

beforeEach(setUpCompletionScreenHarness);
afterEach(resetCompletionScreenHarness);

describe("CompletionScreen with session ratings retired (#889)", () => {
  /** The callbacks the page passes for a sit that has a server row. */
  function syncedSitProps(overrides: Partial<CompletionScreenProps> = {}): Partial<CompletionScreenProps> {
    return {
      onSaveNote: saveNoteMock(),
      onClearNote: clearMock(),
      onSaveMoodMatrix: saveMoodMatrixMock(),
      onClearMoodMatrix: clearMock(),
      ...overrides,
    };
  }

  test("shows no rating slider or ratings text, and the Mood shift grid keeps its Happiness row", async () => {
    await render(syncedSitProps());

    expect(screen().querySelector('input[type="range"], [role="slider"]')).toBeNull();
    expect(screen().textContent).not.toMatch(/rating/i);

    expect(screen().textContent).toContain("Mood Shift");
    for (const column of ["before", "after"]) {
      for (let level = 1; level <= 5; level += 1) {
        expect(moodCell(`Happiness ${column}: ${level}`)).toBeInstanceOf(HTMLButtonElement);
      }
    }
  });

  test("goes from the note straight to the six-row Mood shift grid, then save and return to home", async () => {
    await render(syncedSitProps());

    const noteSection = screen().querySelector("textarea")!.parentElement!;
    const moodSection = noteSection.nextElementSibling!;
    expect(moodSection.textContent).toContain("Mood Shift");
    expect(moodSection.querySelectorAll('button[aria-label$=" before: 1"]')).toHaveLength(6);
    expect(moodSection.nextElementSibling).toBe(returnButton());
  });

  test("a typed note and a tapped mood cell each autosave", async () => {
    const onSaveNote = saveNoteMock();
    const onSaveMoodMatrix = saveMoodMatrixMock();
    await render(syncedSitProps({ onSaveNote, onSaveMoodMatrix }));

    await typeNote("steadier than yesterday");
    await tapMoodCell("Happiness after: 4");
    await settleAutosave();
    await flushWrites();

    expect(onSaveNote).toHaveBeenCalledWith("steadier than yesterday");
    expect(onSaveMoodMatrix).toHaveBeenCalledWith({ happiness: { before: null, after: 4 } });
    expect(screen().textContent).toContain("note saved");
    expect(screen().textContent).toContain("mood saved");
  });

  test("a flush whose note save fails still saves the mood, and the next tap leaves", async () => {
    const onSaveNote = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValue(new Error("offline"));
    const onSaveMoodMatrix = saveMoodMatrixMock();
    const onReturn = vi.fn();
    await render(syncedSitProps({ onSaveNote, onSaveMoodMatrix, onReturn }));

    await typeNote("before the flush");
    await tapMoodCell("Calm after: 4");
    await tapReturn();

    // Both writes were tried; the note's failure keeps the screen up.
    expect(onSaveNote).toHaveBeenCalledTimes(1);
    expect(onSaveMoodMatrix).toHaveBeenCalledWith({ calm: { before: null, after: 4 } });
    expect(onReturn).not.toHaveBeenCalled();
    expect(screen().textContent).toContain("failed to save");

    // The second tap leaves without sending either write again.
    await tapReturn();
    expect(onReturn).toHaveBeenCalledTimes(1);
    expect(onSaveNote).toHaveBeenCalledTimes(1);
    expect(onSaveMoodMatrix).toHaveBeenCalledTimes(1);
  });

  test("#947: the second tap leaves at once but hands over a promise that waits for a write still in flight", async () => {
    let finishSave!: () => void;
    const onSaveNote = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const onReturn = vi.fn<(writesSettled: Promise<void>) => void>();
    await render(syncedSitProps({ onSaveNote, onReturn }));

    await typeNote("before the flush");
    await tapReturn();
    expect(onReturn).not.toHaveBeenCalled();

    // An edit after the failure autosaves, and that save is still on the wire.
    await typeNote("after the flush");
    await settleAutosave();
    expect(onSaveNote).toHaveBeenCalledTimes(2);

    await tapReturn();
    expect(onReturn).toHaveBeenCalledTimes(1);
    let settled = false;
    void onReturn.mock.calls[0]![0].then(() => { settled = true; });
    await flushWrites();
    expect(settled).toBe(false);

    await act(async () => {
      finishSave();
    });
    await flushWrites();
    expect(settled).toBe(true);
  });

  test("#947: an edit still inside its debounce when the second tap leaves is sent, not lost", async () => {
    const onSaveNote = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const onReturn = vi.fn<(writesSettled: Promise<void>) => void>();
    await render(syncedSitProps({ onSaveNote, onReturn }));

    await typeNote("before the flush");
    await tapReturn();
    expect(onReturn).not.toHaveBeenCalled();

    // Typed after the failure, and left before its autosave timer fired.
    await typeNote("after the flush");
    await tapReturn();

    expect(onReturn).toHaveBeenCalledTimes(1);
    await act(async () => {
      await onReturn.mock.calls[0]![0];
    });
    expect(onSaveNote).toHaveBeenCalledTimes(2);
    expect(onSaveNote).toHaveBeenLastCalledWith("after the flush");
  });
});
