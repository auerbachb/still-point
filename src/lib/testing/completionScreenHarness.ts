import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import { COMPLETION_AUTOSAVE_MS, COMPLETION_RETURN_LABEL } from "@/lib/completionAutosave";

/**
 * Shared harness for the `CompletionScreen.*.test.ts` files (#1157).
 *
 * The suite is split by concern so a change to one part of the recap touches
 * one file. The tests drive the real component — the note textarea, the mood
 * cells and the return button — against fake timers for the autosave debounce.
 * Every file still needs, at its top:
 *
 * - `/** @vitest-environment jsdom *\/`
 * - `beforeEach(setUpCompletionScreenHarness)`
 * - `afterEach(resetCompletionScreenHarness)`
 */

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { CompletionScreen } = await import("@/components/CompletionScreen");

export type CompletionScreenProps = Parameters<typeof CompletionScreen>[0];

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Fake timers for the autosave debounce, and a quiet console for React's warnings. */
export function setUpCompletionScreenHarness(): void {
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
}

/** Unmounts the rendered screen and restores timers and spies. */
export async function resetCompletionScreenHarness(): Promise<void> {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
}

/** The element the screen is rendered into. */
export function screen(): HTMLDivElement {
  if (!container) throw new Error("render() the CompletionScreen first");
  return container;
}

export async function render(props: Partial<CompletionScreenProps>): Promise<void> {
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

/** A note save that succeeds at once. */
export function saveNoteMock() {
  return vi.fn(async (_text: string) => {});
}

/** A mood-matrix save that succeeds at once. */
export function saveMoodMatrixMock() {
  return vi.fn(async (_matrix: Record<string, unknown>) => {});
}

/** A note or mood-matrix clear that succeeds at once. */
export function clearMock() {
  return vi.fn(async () => {});
}

/**
 * A save whose promise stays pending until `finish()` — for writes still on the
 * wire. `finish()` settles the most recent call and runs the writes it frees.
 */
export function pendingSaveMock() {
  let resolveSave!: () => void;
  const save = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
  async function finish(): Promise<void> {
    await act(async () => {
      resolveSave();
    });
    await flushWrites();
  }
  return { save, finish };
}

export async function typeNote(text: string): Promise<void> {
  const textarea = screen().querySelector("textarea")!;
  // React tracks the value it last rendered; set it through the native setter
  // so the input event reads as a real edit.
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setValue.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Run the autosave debounce and the writes it starts. */
export async function settleAutosave(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(COMPLETION_AUTOSAVE_MS);
  });
}

export async function flushWrites(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

export function moodCell(label: string): HTMLButtonElement {
  return screen().querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

export async function tapMoodCell(label: string): Promise<void> {
  const cell = moodCell(label);
  await act(async () => {
    cell.click();
  });
}

export function returnButton(): HTMLButtonElement {
  return [...screen().querySelectorAll("button")]
    .find((candidate) => candidate.textContent === COMPLETION_RETURN_LABEL)!;
}

export async function tapReturn(): Promise<void> {
  const button = returnButton();
  await act(async () => {
    button.click();
  });
  await flushWrites();
}
