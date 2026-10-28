/** @vitest-environment jsdom */
/**
 * Issue #792 — the completion screen autosaves its note (#753), so emptying a
 * note that was already saved has to delete the stored value.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  clearMock,
  pendingSaveMock,
  render,
  resetCompletionScreenHarness,
  saveNoteMock,
  screen,
  settleAutosave,
  setUpCompletionScreenHarness,
  tapReturn,
  typeNote,
} from "@/lib/testing/completionScreenHarness";

beforeEach(setUpCompletionScreenHarness);
afterEach(resetCompletionScreenHarness);

describe("CompletionScreen note clear (#792)", () => {
  test("emptying a saved note clears it instead of leaving the old text stored", async () => {
    const onSaveNote = saveNoteMock();
    const onClearNote = clearMock();
    await render({ onSaveNote, onClearNote });

    await typeNote("first thoughts");
    await settleAutosave();
    expect(onSaveNote).toHaveBeenCalledWith("first thoughts");

    await typeNote("   ");
    await settleAutosave();
    expect(onClearNote).toHaveBeenCalledTimes(1);
    expect(onSaveNote).toHaveBeenCalledTimes(1);
  });

  test("a note emptied before it was ever saved sends nothing", async () => {
    const onSaveNote = saveNoteMock();
    const onClearNote = clearMock();
    await render({ onSaveNote, onClearNote });

    await typeNote("half a thought");
    await typeNote("");
    await settleAutosave();

    expect(onSaveNote).not.toHaveBeenCalled();
    expect(onClearNote).not.toHaveBeenCalled();
  });

  test("a note emptied while its save is still in flight is cleared once that save lands", async () => {
    const { save: onSaveNote, finish: finishSave } = pendingSaveMock();
    const onClearNote = clearMock();
    await render({ onSaveNote, onClearNote });

    await typeNote("first thoughts");
    await settleAutosave();
    expect(onSaveNote).toHaveBeenCalledTimes(1);

    await typeNote("");
    await settleAutosave();
    // Queued behind the save it undoes, not dropped because nothing was stored yet.
    expect(onClearNote).not.toHaveBeenCalled();

    await finishSave();
    expect(onClearNote).toHaveBeenCalledTimes(1);
  });

  test("save and return flushes a clear the debounce has not sent yet", async () => {
    const onSaveNote = saveNoteMock();
    const onClearNote = clearMock();
    const onReturn = vi.fn();
    await render({ onSaveNote, onClearNote, onReturn });

    await typeNote("first thoughts");
    await settleAutosave();
    await typeNote("");
    await tapReturn();

    expect(onClearNote).toHaveBeenCalledTimes(1);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test("a failed clear shows the save error and is retried by save and return", async () => {
    const onSaveNote = saveNoteMock();
    const onClearNote = vi.fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    const onReturn = vi.fn();
    await render({ onSaveNote, onClearNote, onReturn });

    await typeNote("first thoughts");
    await settleAutosave();
    await typeNote("");
    await settleAutosave();
    expect(onClearNote).toHaveBeenCalledTimes(1);
    expect(screen().textContent).toContain("failed to save");

    await tapReturn();
    expect(onClearNote).toHaveBeenCalledTimes(2);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test("a note emptied after its save failed is still cleared, since that save may have landed", async () => {
    const onSaveNote = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("response lost"));
    const onClearNote = clearMock();
    await render({ onSaveNote, onClearNote });

    await typeNote("first thoughts");
    await settleAutosave();
    expect(onSaveNote).toHaveBeenCalledTimes(1);

    await typeNote("");
    await settleAutosave();
    expect(onClearNote).toHaveBeenCalledTimes(1);
  });
});
