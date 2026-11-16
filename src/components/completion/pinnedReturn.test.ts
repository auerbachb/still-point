/**
 * #979: the bottom return button is pinned only where `overflow-x: clip` is
 * supported, and the compact scroll padding reserves the pin's extra 52px only
 * when the pin applies. Both branches of each decision are covered here.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  compactScrollPaddingBottom,
  pinnedClearancePx,
  returnPinSupported,
  shouldPinReturnButton,
} from "@/components/completion/pinnedReturn";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("returnPinSupported (#979)", () => {
  test("is true when the browser supports overflow-x: clip", () => {
    vi.stubGlobal("CSS", { supports: (property: string, value: string) => property === "overflow-x" && value === "clip" });
    expect(returnPinSupported()).toBe(true);
  });

  test("is false when overflow-x: clip is unsupported (hidden fallback)", () => {
    vi.stubGlobal("CSS", { supports: () => false });
    expect(returnPinSupported()).toBe(false);
  });

  test("is false when CSS.supports is unavailable", () => {
    vi.stubGlobal("CSS", undefined);
    expect(returnPinSupported()).toBe(false);
  });
});

describe("shouldPinReturnButton (#979)", () => {
  test("pins on compact layouts where the pin engages", () => {
    expect(shouldPinReturnButton(true, true)).toBe(true);
  });

  test("does not pin where the pin does not engage", () => {
    expect(shouldPinReturnButton(true, false)).toBe(false);
  });

  test("never pins on the desktop recap", () => {
    expect(shouldPinReturnButton(false, true)).toBe(false);
    expect(shouldPinReturnButton(false, false)).toBe(false);
  });
});

describe("compactScrollPaddingBottom (#979)", () => {
  test("falls back to the 44px minimum plus 8px margin when pinned and unmeasured", () => {
    expect(compactScrollPaddingBottom(true)).toBe(
      "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 52px)",
    );
  });

  test("reserves the measured clearance of a taller pinned button", () => {
    // Text zoom makes the button 76px tall; with its 8px margin, 84px must clear.
    const measured = pinnedClearancePx(76, 8);
    expect(measured).toBe(84);
    expect(compactScrollPaddingBottom(true, measured)).toBe(
      "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 84px)",
    );
  });

  test("ignores any measurement when the pin does not apply", () => {
    expect(compactScrollPaddingBottom(false)).toBe(
      "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))",
    );
    expect(compactScrollPaddingBottom(false, 84)).toBe(
      "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))",
    );
  });
});

describe("pinnedClearancePx (#979)", () => {
  test("is the rendered height plus the top margin, rounded up", () => {
    expect(pinnedClearancePx(44, 8)).toBe(52);
    expect(pinnedClearancePx(43.2, 8)).toBe(52);
  });
});
