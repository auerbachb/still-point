/** @vitest-environment jsdom */
/**
 * Issue #1183 — the recap has a return button at the top, above the summary, so
 * the owner does not scroll for it. The bottom button stays. Both share one
 * handler, so a tap at either runs the same save-and-return flush.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { COMPLETION_RETURN_LABEL } from "@/lib/completionAutosave";
import {
  clearMock,
  flushWrites,
  pendingSaveMock,
  render,
  resetCompletionScreenHarness,
  returnButton,
  saveNoteMock,
  screen,
  setUpCompletionScreenHarness,
  tapReturn,
  typeNote,
} from "@/lib/testing/completionScreenHarness";

beforeEach(setUpCompletionScreenHarness);
afterEach(resetCompletionScreenHarness);

describe("CompletionScreen top return button (#1183)", () => {
  test("renders a top and a bottom return button with the same label", async () => {
    await render({});

    const top = returnButton("top");
    const bottom = returnButton("bottom");
    expect(top).not.toBe(bottom);
    expect(top.textContent).toBe(COMPLETION_RETURN_LABEL);
    expect(bottom.textContent).toBe(COMPLETION_RETURN_LABEL);
  });

  test("places the top button above the summary and the bottom button below the fields", async () => {
    await render({ onSaveNote: saveNoteMock() });

    const top = returnButton("top");
    const bottom = returnButton("bottom");
    // Top comes before the summary and before the note field; bottom comes last.
    expect(top.compareDocumentPosition(screen().querySelector("textarea")!))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(top.compareDocumentPosition(bottom)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(bottom.nextElementSibling).toBeNull();
  });

  test("a top tap with nothing to save leaves once", async () => {
    const onReturn = vi.fn();
    await render({ onReturn });

    await tapReturn("top");

    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test("a top tap flushes a note the debounce has not sent yet before leaving", async () => {
    const onSaveNote = saveNoteMock();
    const onReturn = vi.fn();
    await render({ onSaveNote, onReturn });

    await typeNote("quiet after the bell");
    await tapReturn("top");

    expect(onSaveNote).toHaveBeenCalledWith("quiet after the bell");
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test("both buttons are disabled together while a return is saving", async () => {
    const pending = pendingSaveMock();
    const onReturn = vi.fn();
    await render({ onSaveNote: pending.save, onReturn });

    await typeNote("still writing");
    await tapReturn("top");

    expect(returnButton("top").disabled).toBe(true);
    expect(returnButton("bottom").disabled).toBe(true);

    await pending.finish();
    await flushWrites();
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test("both buttons render when there are no survey fields", async () => {
    await render({ onSaveNote: undefined, onSaveMoodMatrix: undefined, onClearNote: clearMock() });

    expect(returnButton("top")).toBeInstanceOf(HTMLButtonElement);
    expect(returnButton("bottom")).toBeInstanceOf(HTMLButtonElement);
  });
});
