/** @vitest-environment jsdom */
/**
 * Issue #911 — the Mood shift grid stacks BEFORE above AFTER on narrow screens.
 * These render both layouts and check that they hold the same cells, send the
 * same values, and that the stacked one fits the recap at a 320px viewport.
 * jsdom does no layout, so the rendered geometry is covered by
 * `e2e/layout/issue-911-mood-shift-narrow.spec.ts`.
 */
import { act, createElement, useState, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { COMPLETION_AUTOSAVE_MS } from "@/lib/completionAutosave";
import { MOOD_KEYS, MOOD_LABELS, type MoodMatrixValue } from "@/lib/moodMatrix";

// React 19 requires this flag for `act` to drive effects outside a test renderer.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { MoodMatrix } = await import("./MoodMatrix");
const { CompletionScreen } = await import("./CompletionScreen");

type Layout = "grid" | "stacked";

const LAYOUTS: readonly Layout[] = ["grid", "stacked"];
const SIDES = ["before", "after"] as const;
/** Five 28px boxes and four 3px gaps. */
const SCALE_WIDTH = `${5 * 28 + 4 * 3}px`;
/** The recap's Mood shift wrapper at a 320px viewport: min(420px, 100vw - 40px). */
const NARROWEST_WRAPPER_PX = 280;

const ALL_CELL_LABELS = MOOD_KEYS.flatMap((key) =>
  SIDES.flatMap((side) => [1, 2, 3, 4, 5].map((level) => `${MOOD_LABELS[key]} ${side}: ${level}`)),
);

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

async function mount(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
}

/** A matrix that holds its own value, as the recap does, and reports each change. */
async function renderMatrix(
  layout: Layout,
  onChange: (value: MoodMatrixValue) => void = () => {},
): Promise<void> {
  function Harness() {
    const [value, setValue] = useState<MoodMatrixValue>({});
    return createElement(MoodMatrix, {
      value,
      layout,
      onChange: (next: MoodMatrixValue) => {
        onChange(next);
        setValue(next);
      },
    });
  }
  await mount(createElement(Harness));
}

function cells(): HTMLButtonElement[] {
  return [...container!.querySelectorAll<HTMLButtonElement>("button[aria-label]")];
}

function cell(label: string): HTMLButtonElement {
  return container!.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}

async function tap(label: string): Promise<void> {
  const target = cell(label);
  await act(async () => {
    target.click();
  });
}

function byTestIdPrefix(prefix: string): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>(`[data-testid^="${prefix}"]`)];
}

function grids(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>("div")].filter((el) => el.style.display === "grid");
}

describe("MoodMatrix layouts (#911)", () => {
  test.each(LAYOUTS)("the %s layout renders every cell, 28px square, in row order", async (layout) => {
    await renderMatrix(layout);

    expect(container!.querySelector('[data-testid="mood-matrix"]')?.getAttribute("data-layout")).toBe(layout);
    expect(cells().map((button) => button.getAttribute("aria-label"))).toEqual(ALL_CELL_LABELS);
    for (const button of cells()) {
      expect(button.style.width).toBe("28px");
      expect(button.style.height).toBe("28px");
    }
  });

  test("both layouts send the same values for the same taps, a clear included", async () => {
    const taps = ["Calm before: 3", "Calm after: 4", "Happiness before: 2", "Calm before: 3", "Overall after: 5"];
    const sent: Record<Layout, MoodMatrixValue[]> = { grid: [], stacked: [] };

    for (const layout of LAYOUTS) {
      await renderMatrix(layout, (value) => sent[layout].push(value));
      for (const label of taps) await tap(label);
      expect(cell("Calm before: 3").getAttribute("aria-pressed")).toBe("false");
      expect(cell("Calm after: 4").getAttribute("aria-pressed")).toBe("true");
      await act(async () => {
        root?.unmount();
      });
      container?.remove();
      root = null;
      container = null;
    }

    expect(sent.stacked).toEqual(sent.grid);
    expect(sent.stacked.at(-1)).toEqual({
      calm: { before: null, after: 4 },
      happiness: { before: 2, after: null },
      overall: { before: null, after: 5 },
    });
  });

  test("the stacked layout's grids share one template that fits the narrowest recap", async () => {
    await renderMatrix("stacked");

    const stacked = grids();
    // The low/high hint row, then one block per mood.
    expect(stacked).toHaveLength(MOOD_KEYS.length + 1);
    expect(new Set(stacked.map((grid) => grid.style.gridTemplateColumns))).toEqual(
      new Set([`52px ${SCALE_WIDTH}`]),
    );
    for (const grid of stacked) {
      const tracks = grid.style.gridTemplateColumns.split(" ").map((track) => Number.parseFloat(track));
      const width = tracks.reduce((sum, track) => sum + track, 0) + Number.parseFloat(grid.style.columnGap);
      expect(width).toBeLessThanOrEqual(NARROWEST_WRAPPER_PX);
    }
  });

  test("a stacked mood is its label on a line of its own, then a BEFORE row and an AFTER row", async () => {
    await renderMatrix("stacked");

    const blocks = grids().slice(1);
    expect(blocks).toHaveLength(MOOD_KEYS.length);
    blocks.forEach((block, index) => {
      const key = MOOD_KEYS[index];
      const [label, beforeLabel, beforeScale, afterLabel, afterScale] = [...block.children] as HTMLElement[];
      expect(block.children).toHaveLength(5);
      expect(label.textContent).toBe(MOOD_LABELS[key]);
      expect(label.style.gridColumn).toBe("1 / -1");
      expect(label.style.whiteSpace).toBe("nowrap");
      expect(beforeLabel.textContent).toBe("Before");
      expect(beforeScale.getAttribute("data-testid")).toBe(`mood-matrix-scale-${key}-before`);
      expect(afterLabel.textContent).toBe("After");
      expect(afterScale.getAttribute("data-testid")).toBe(`mood-matrix-scale-${key}-after`);
    });
  });

  test.each(LAYOUTS)("in the %s layout the headers, hints and box groups are one scale wide", async (layout) => {
    await renderMatrix(layout);

    const scales = byTestIdPrefix("mood-matrix-scale-");
    expect(scales).toHaveLength(MOOD_KEYS.length * SIDES.length);
    const hints = byTestIdPrefix("mood-matrix-hint");
    expect(hints).toHaveLength(layout === "grid" ? 2 : 1);
    const headers = byTestIdPrefix("mood-matrix-header-");
    expect(headers).toHaveLength(layout === "grid" ? 2 : 0);
    for (const element of [...scales, ...hints, ...headers]) {
      expect(element.style.width).toBe(SCALE_WIDTH);
    }
  });

  test("disabled disables every cell in the stacked layout", async () => {
    await mount(createElement(MoodMatrix, { value: {}, onChange: () => {}, disabled: true, layout: "stacked" }));

    expect(cells()).toHaveLength(ALL_CELL_LABELS.length);
    expect(cells().every((button) => button.disabled)).toBe(true);
  });
});

describe("CompletionScreen picks the Mood shift layout from compact (#911)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderRecap(props: Partial<Parameters<typeof CompletionScreen>[0]>): Promise<void> {
    await mount(createElement(CompletionScreen, {
      dayNumber: 3,
      duration: 80,
      clearPercent: 74,
      thoughtCount: 0,
      thoughts: [],
      nextDuration: 90,
      onReturn: () => {},
      onSaveMoodMatrix: async () => {},
      ...props,
    }));
  }

  async function settleAutosave(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COMPLETION_AUTOSAVE_MS);
    });
  }

  test.each([
    [true, "stacked"],
    [false, "grid"],
  ] as const)("compact=%s renders the %s layout", async (compact, layout) => {
    await renderRecap({ compact });

    expect(container!.querySelector('[data-testid="mood-matrix"]')?.getAttribute("data-layout")).toBe(layout);
  });

  test("a compact recap saves a pick and clears it, as the grid does", async () => {
    const onSaveMoodMatrix = vi.fn(async (_matrix: Record<string, unknown>) => {});
    const onClearMoodMatrix = vi.fn(async () => {});
    await renderRecap({ compact: true, onSaveMoodMatrix, onClearMoodMatrix });

    await tap("Calm before: 3");
    await settleAutosave();
    expect(onSaveMoodMatrix).toHaveBeenCalledWith({ calm: { before: 3, after: null } });

    await tap("Calm before: 3");
    await settleAutosave();
    expect(onClearMoodMatrix).toHaveBeenCalledTimes(1);
    expect(onSaveMoodMatrix).toHaveBeenCalledTimes(1);
  });
});
