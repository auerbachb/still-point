/** @vitest-environment jsdom */
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  advance,
  blockLabels,
  digits,
  mount,
  resetBlockTimerHarness,
  teardownBlockTimerHarness,
} from "@/lib/testing/blockTimerHarness";

/**
 * #732 / #1143 — what the timer draws: the block grid, the digits, and the
 * show/hide toggle.
 *
 * Harness and conventions: `src/lib/testing/blockTimerHarness.ts`.
 */

// The fake audio boundary, shared with the harness (#1143): see `blockTimerAudio.ts`.
vi.mock("@/lib/audio", async (importOriginal) => {
  const { mockAudio } = await import("@/lib/testing/blockTimerAudio");
  return mockAudio(await importOriginal<typeof import("@/lib/audio")>());
});

beforeEach(resetBlockTimerHarness);
afterEach(teardownBlockTimerHarness);

describe("BlockTimer rendering", () => {
  it("draws minute blocks then the final minute in ten-second blocks", async () => {
    const { container } = await mount({ totalSeconds: 130, isActive: false });

    expect(digits(container).textContent).toBe("2:10");
    expect(blockLabels(container)).toEqual(["1m", "2m", "10s"]);
    expect(container.textContent).toContain("final minute");
  });

  it("draws a short sit as ten-second blocks only", async () => {
    const { container } = await mount({ totalSeconds: 60, isActive: false });

    expect(blockLabels(container)).toEqual(["10s", "20s", "30s", "40s", "50s", "60s"]);
    expect(container.textContent).not.toContain("final minute");
  });

  it("counts the digits down as the sit runs", async () => {
    const { container } = await mount({ totalSeconds: 130, soundPrefs: undefined });

    await advance(61_000);

    expect(digits(container).textContent).toBe("1:09");
  });

  it("hides and shows the digits and remembers the choice", async () => {
    const { container } = await mount({ totalSeconds: 130, isActive: false });
    const toggle = container.querySelector("button");
    if (!(toggle instanceof HTMLButtonElement)) throw new Error("missing toggle");

    expect(toggle.getAttribute("aria-label")).toBe("Hide numerical timer");
    await act(async () => {
      toggle.click();
    });

    expect(toggle.getAttribute("aria-label")).toBe("Show numerical timer");
    expect(digits(container).getAttribute("aria-hidden")).toBe("true");
    expect(JSON.parse(localStorage.getItem("stillpoint_display_prefs") ?? "{}")).toEqual({ showTimer: false });
  });

  it("renders only the digits in minimal view, even with the digits hidden", async () => {
    localStorage.setItem("stillpoint_display_prefs", JSON.stringify({ showTimer: false }));
    const { container } = await mount({ totalSeconds: 130, isActive: false, minimal: true });

    expect(container.querySelector("button")).toBeNull();
    expect(blockLabels(container)).toEqual([]);
    expect(digits(container).getAttribute("aria-hidden")).toBe("false");
    expect(container.textContent).not.toContain("final minute");
  });
});
