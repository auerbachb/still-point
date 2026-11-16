import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import { tap } from "../utils/mobile-helpers";

// #662: the sand toggle is pinned to the left edge of the countdown row. At a
// 320px phone width it must not cover the countdown digits (digit mode) or the
// source pile (sand mode). Measured with bounding boxes, not inferred from CSS.
const NARROW_WIDTH = 320;
const TEN_MINUTE_DAY = 128;
const VIEWPORT_HEIGHT = 667;

type Box = { left: number; right: number };

/** Horizontal extent of the rendered countdown glyphs (a text Range, not the
 *  full-width block), and the toggle and sand-pile boxes, measured in one pass. */
function measureDigits(page: Page, widestText: string) {
  return page.evaluate((widest: string) => {
    const digits = document.querySelector("[data-session-timer-digits]");
    if (!digits) throw new Error("digits element missing");
    const live = (digits.textContent ?? "").trim();
    // Geometry depends only on the glyph string, so measure the widest countdown
    // (10:00, the ten-minute cap) in place of the live string. The live value is reported too.
    digits.textContent = widest;
    const range = document.createRange();
    range.selectNodeContents(digits);
    const text = range.getBoundingClientRect();
    const toggle = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Show sand animation",
    );
    if (!toggle) throw new Error("sand toggle missing in digit mode");
    const t = toggle.getBoundingClientRect();
    return {
      text: text.toJSON(),
      toggle: { left: t.left, right: t.right } as Box,
      countdown: live,
      measuredText: widest,
      viewport: document.documentElement.clientWidth,
    };
    }, widestText);
}

function measureSand(page: Page) {
  return page.evaluate(() => {
    const wrapper = document.querySelector("[data-session-timer-sand]");
    if (!wrapper) throw new Error("sand view missing");
    // The first rect in the carrier SVG is the source pile.
    const source = wrapper.querySelector("svg rect");
    if (!source) throw new Error("source pile missing");
    const s = source.getBoundingClientRect();
    const toggle = Array.from(document.querySelectorAll("button")).find(
      (b) => b.getAttribute("aria-label") === "Show numerical timer",
    );
    if (!toggle) throw new Error("digits toggle missing in sand mode");
    const t = toggle.getBoundingClientRect();
    return {
      source: { left: s.left, right: s.right } as Box,
      toggle: { left: t.left, right: t.right } as Box,
      viewport: document.documentElement.clientWidth,
    };
  });
}

test.describe("#662 sand toggle clearance @320px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: NARROW_WIDTH, height: VIEWPORT_HEIGHT });
  });

  test("digit mode: the sand toggle does not intersect the countdown text", async ({ page, mockApiState, ensureLoggedIn }) => {
    // A day past the fork holds the sit at the ten-minute cap, so the countdown reads "10:00".
    mockApiState.user.currentDay = TEN_MINUTE_DAY;
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: "Begin", exact: true }));
    await expect(page.locator("[data-session-timer-digits]")).toBeVisible();

    const m = await measureDigits(page, "10:00");
    const gap = m.text.left - m.toggle.right;
    console.log(`#662 digit mode @${NARROW_WIDTH}px: live "${m.countdown}", measured "${m.measuredText}" text.left=${m.text.left.toFixed(1)} toggle.right=${m.toggle.right.toFixed(1)} gap=${gap.toFixed(1)}px`);
    expect(m.toggle.left).toBeGreaterThanOrEqual(0);
    expect(gap, "gap between toggle right edge and countdown text (px)").toBeGreaterThanOrEqual(0);
  });

  test("sand mode: the digits toggle does not intersect the source pile", async ({ page, mockApiState, ensureLoggedIn }) => {
    // A day past the fork holds the sit at the ten-minute cap, so the countdown reads "10:00".
    mockApiState.user.currentDay = TEN_MINUTE_DAY;
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: "Begin", exact: true }));
    await tap(page.getByRole("button", { name: "Show sand animation" }));
    await expect(page.locator("[data-session-timer-sand]")).toBeVisible();

    const m = await measureSand(page);
    const gap = m.source.left - m.toggle.right;
    console.log(`#662 sand mode @${NARROW_WIDTH}px: source.left=${m.source.left.toFixed(1)} toggle.right=${m.toggle.right.toFixed(1)} gap=${gap.toFixed(1)}px`);
    expect(gap, "gap between toggle right edge and source pile (px)").toBeGreaterThanOrEqual(0);
  });
});
