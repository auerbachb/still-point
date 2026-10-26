/** @vitest-environment jsdom */
/**
 * Issue #792 — the completion screen autosaves its note and mood (#753), so
 * emptying a field that was already saved has to delete the stored value. These
 * drive the real component: the note textarea, the mood cells, and the return
 * button, against fake timers for the autosave debounce.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { COMPLETION_AUTOSAVE_MS, COMPLETION_RETURN_LABEL } from "@/lib/completionAutosave";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CompletionScreen } = await import("./CompletionScreen");

type Props = Parameters<typeof CompletionScreen>[0];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function render(props: Partial<Props>): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(CompletionScreen, {
      dayNumber: 3,
      duration: 80,
      clearPercent: 74,
      thoughtCount: 0,
      thoughts: [],
      nextDuration: 90,
      onReturn: () => {},
      ...props,
    }));
  });
}

async function typeNote(text: string): Promise<void> {
  const textarea = container!.querySelector("textarea")!;
  // React tracks the value it last rendered; set it through the native setter
  // so the input event reads as a real edit.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Run the autosave debounce and the writes it starts. */
async function settleAutosave(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COMPLETION_AUTOSAVE_MS);
  });
}

async function flushWrites(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function tapMoodCell(label: string): Promise<void> {
  const cell = container!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(async () => {
    cell.click();
  });
}

async function tapReturn(): Promise<void> {
  const button = [...container!.querySelectorAll("button")]
    .find((candidate) => candidate.textContent === COMPLETION_RETURN_LABEL)!;
  await act(async () => {
    button.click();
  });
  await flushWrites();
}

describe("CompletionScreen note clear (#792)", () => {
  test("emptying a saved note clears it instead of leaving the old text stored", async () => {
    const onSaveNote = vi.fn(async (_text: string) => {});
    const onClearNote = vi.fn(async () => {});
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
    const onSaveNote = vi.fn(async (_text: string) => {});
    const onClearNote = vi.fn(async () => {});
    await render({ onSaveNote, onClearNote });

    await typeNote("half a thought");
    await typeNote("");
    await settleAutosave();

    expect(onSaveNote).not.toHaveBeenCalled();
    expect(onClearNote).not.toHaveBeenCalled();
  });

  test("a note emptied while its save is still in flight is cleared once that save lands", async () => {
    let finishSave!: () => void;
    const onSaveNote = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const onClearNote = vi.fn(async () => {});
    await render({ onSaveNote, onClearNote });

    await typeNote("first thoughts");
    await settleAutosave();
    expect(onSaveNote).toHaveBeenCalledTimes(1);

    await typeNote("");
    await settleAutosave();
    // Queued behind the save it undoes, not dropped because nothing was stored yet.
    expect(onClearNote).not.toHaveBeenCalled();

    await act(async () => {
      finishSave();
    });
    await flushWrites();
    expect(onClearNote).toHaveBeenCalledTimes(1);
  });

  test("save and return flushes a clear the debounce has not sent yet", async () => {
    const onSaveNote = vi.fn(async (_text: string) => {});
    const onClearNote = vi.fn(async () => {});
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
    const onSaveNote = vi.fn(async (_text: string) => {});
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
    expect(container!.textContent).toContain("failed to save");

    await tapReturn();
    expect(onClearNote).toHaveBeenCalledTimes(2);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  test("a note emptied after its save failed is still cleared, since that save may have landed", async () => {
    const onSaveNote = vi.fn<(text: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("response lost"));
    const onClearNote = vi.fn(async () => {});
    await render({ onSaveNote, onClearNote });

    await typeNote("first thoughts");
    await settleAutosave();
    expect(onSaveNote).toHaveBeenCalledTimes(1);

    await typeNote("");
    await settleAutosave();
    expect(onClearNote).toHaveBeenCalledTimes(1);
  });
});

describe("CompletionScreen mood clear (#792)", () => {
  test("deselecting every mood cell clears the saved matrix", async () => {
    const onSaveMoodMatrix = vi.fn(async (_matrix: Record<string, unknown>) => {});
    const onClearMoodMatrix = vi.fn(async () => {});
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
    const onSaveMoodMatrix = vi.fn(async (_matrix: Record<string, unknown>) => {});
    const onClearMoodMatrix = vi.fn(async () => {});
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
    let finishSave!: () => void;
    const onSaveMoodMatrix = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    const onClearMoodMatrix = vi.fn(async () => {});
    await render({ onSaveMoodMatrix, onClearMoodMatrix });

    await tapMoodCell("Energy after: 5");
    await settleAutosave();
    await tapMoodCell("Energy after: 5");
    await settleAutosave();
    expect(onClearMoodMatrix).not.toHaveBeenCalled();

    await act(async () => {
      finishSave();
    });
    await flushWrites();
    expect(onClearMoodMatrix).toHaveBeenCalledTimes(1);
  });

  test("a matrix never saved sends nothing when its cells are deselected", async () => {
    const onSaveMoodMatrix = vi.fn(async (_matrix: Record<string, unknown>) => {});
    const onClearMoodMatrix = vi.fn(async () => {});
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
    const onClearMoodMatrix = vi.fn(async () => {});
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
    const onClearMoodMatrix = vi.fn(async () => {});
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
