/**
 * #979: the bottom return button is pinned only where `overflow-x: clip` is
 * supported, and the compact scroll padding reserves the pin's extra 52px only
 * when the pin applies. Both branches of each decision are covered here.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  compactScrollPaddingBottom,
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
  test("reserves the nav clearance plus the pinned button's 52px when pinned", () => {
    expect(compactScrollPaddingBottom(true)).toBe(
      "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px) + 52px)",
    );
  });

  test("reserves only the nav clearance when the pin does not apply", () => {
    expect(compactScrollPaddingBottom(false)).toBe(
      "calc(var(--nav-h) + env(safe-area-inset-bottom, 0px))",
    );
  });
});
