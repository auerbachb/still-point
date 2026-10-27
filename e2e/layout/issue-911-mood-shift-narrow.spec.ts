import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import { expectNoHorizontalOverflow, tap, tapWithControlReveal } from "../utils/mobile-helpers";
import { MOOD_KEYS } from "../../src/lib/moodMatrix";

// #911: the recap's Mood shift grid at phone widths. Below 424px the
// side-by-side grid was wider than its wrapper, so the AFTER boxes were cut off
// and the headers and hints drifted off their boxes. Narrow screens now stack
// BEFORE above AFTER. Widths are set explicitly, as in the #473 spec, so the
// spec does not depend on the project's device preset.
const NARROW_WIDTHS = [320, 375] as const;
/** Above the recap's 600px compact breakpoint, where the grid stays side by side. */
const WIDE_WIDTH = 768;
const VIEWPORT_HEIGHT = 667;
/** The design call's minimum tap target: no layout shrinks a box below 28px. */
const MIN_BOX_PX = 28;
const TOLERANCE_PX = 1;
const SIDES = ["before", "after"] as const;
const BOX_COUNT = MOOD_KEYS.length * SIDES.length * 5;

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };

/** Begin a sit, end it early and wait for the recap's Mood shift grid. The grid
 *  only renders for a sit the server holds, which the mocked API answers at once. */
async function openRecap(page: Page, ensureLoggedIn: () => Promise<unknown>) {
  await ensureLoggedIn();
  await tap(page.getByRole("button", { name: "Begin" }));
  await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
  await expect(page.getByRole("heading", { name: /Day .* Complete/i })).toBeVisible();
  await expect(page.getByTestId("mood-matrix")).toBeVisible();
}

/** Every rect the checks need, in one pass and without scrolling: the matrix,
 *  each of its test-id'd parts, each box by its aria-label, and the two ends of
 *  each low/high hint. */
function measure(page: Page) {
  return page.evaluate(() => {
    const toRect = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    };
    const matrix = document.querySelector('[data-testid="mood-matrix"]')!;
    const parts: Record<string, Rect> = {};
    for (const el of matrix.querySelectorAll("[data-testid]")) parts[el.getAttribute("data-testid")!] = toRect(el);
    const boxes: Record<string, Rect> = {};
    for (const el of matrix.querySelectorAll("button[aria-label]")) boxes[el.getAttribute("aria-label")!] = toRect(el);
    const hintEnds: Record<string, { low: Rect; high: Rect }> = {};
    for (const hint of matrix.querySelectorAll('[data-testid^="mood-matrix-hint"]')) {
      hintEnds[hint.getAttribute("data-testid")!] = {
        low: toRect(hint.firstElementChild!),
        high: toRect(hint.lastElementChild!),
      };
    }
    return {
      layout: matrix.getAttribute("data-layout"),
      matrix: toRect(matrix),
      parts,
      boxes,
      hintEnds,
      viewportWidth: document.documentElement.clientWidth,
    };
  });
}

type Geometry = Awaited<ReturnType<typeof measure>>;

/** AC 1 and 3: every box in both columns is at least 28 × 28 and sits wholly
 *  inside the viewport and the matrix. */
function expectEveryBoxOnScreen(geometry: Geometry) {
  const boxes = Object.entries(geometry.boxes);
  expect(boxes).toHaveLength(BOX_COUNT);
  for (const [label, box] of boxes) {
    expect(box.width, `${label} width`).toBeGreaterThanOrEqual(MIN_BOX_PX);
    expect(box.height, `${label} height`).toBeGreaterThanOrEqual(MIN_BOX_PX);
    expect(box.left, `${label} should not start left of the viewport`).toBeGreaterThanOrEqual(0);
    expect(box.right, `${label} should not end right of the viewport`).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(box.left, `${label} should start inside the matrix`).toBeGreaterThanOrEqual(geometry.matrix.left - TOLERANCE_PX);
    expect(box.right, `${label} should end inside the matrix`).toBeLessThanOrEqual(geometry.matrix.right + TOLERANCE_PX);
  }
}

/** A hint's low end starts over the scale's first box and its high end finishes
 *  over the fifth. */
function expectHintEndsOverEndBoxes(ends: { low: Rect; high: Rect }, first: Rect, fifth: Rect, label: string) {
  expect(ends.low.left, `${label} low should start over the first box`).toBeGreaterThanOrEqual(first.left - TOLERANCE_PX);
  expect(ends.low.left, `${label} low should start over the first box`).toBeLessThanOrEqual(first.right);
  expect(ends.high.right, `${label} high should end over the fifth box`).toBeGreaterThanOrEqual(fifth.left);
  expect(ends.high.right, `${label} high should end over the fifth box`).toBeLessThanOrEqual(fifth.right + TOLERANCE_PX);
}

function expectSameSpan(actual: Rect, expected: Rect, label: string) {
  expect(Math.abs(actual.left - expected.left), `${label}: left edges`).toBeLessThanOrEqual(TOLERANCE_PX);
  expect(Math.abs(actual.right - expected.right), `${label}: right edges`).toBeLessThanOrEqual(TOLERANCE_PX);
}

for (const width of NARROW_WIDTHS) {
  test.describe(`#911 Mood shift @ ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
    });

    test("stacks BEFORE above AFTER, every box on screen and lined up under the hint", async ({
      page,
      ensureLoggedIn,
    }) => {
      await openRecap(page, ensureLoggedIn);
      await expectNoHorizontalOverflow(page);

      const geometry = await measure(page);
      expect(geometry.layout).toBe("stacked");
      expectEveryBoxOnScreen(geometry);

      // AC 2: one hint row spans every scale, and each BEFORE / AFTER label sits
      // on its own scale's row, left of the boxes.
      const hint = geometry.parts["mood-matrix-hint"];
      for (const key of MOOD_KEYS) {
        for (const side of SIDES) {
          const scale = geometry.parts[`mood-matrix-scale-${key}-${side}`];
          const label = geometry.parts[`mood-matrix-phase-${key}-${side}`];
          expectSameSpan(scale, hint, `${key} ${side} scale under the hint`);
          const labelMiddle = (label.top + label.bottom) / 2;
          expect(labelMiddle, `${key} ${side} label on its row`).toBeGreaterThan(scale.top);
          expect(labelMiddle, `${key} ${side} label on its row`).toBeLessThan(scale.bottom);
          expect(label.right, `${key} ${side} label left of its boxes`).toBeLessThanOrEqual(scale.left + TOLERANCE_PX);
        }
        expect(
          geometry.parts[`mood-matrix-scale-${key}-before`].bottom,
          `${key} BEFORE above AFTER`,
        ).toBeLessThanOrEqual(geometry.parts[`mood-matrix-scale-${key}-after`].top + TOLERANCE_PX);
      }
      expectHintEndsOverEndBoxes(
        geometry.hintEnds["mood-matrix-hint"],
        geometry.boxes["Calm before: 1"],
        geometry.boxes["Calm before: 5"],
        "hint",
      );
    });

    test("a stacked box selects and autosaves on tap; a second tap clears it", async ({
      page,
      ensureLoggedIn,
    }) => {
      // The shared fixture does not mock the recap's PATCH; record it here.
      const patches: unknown[] = [];
      await page.route("**/api/sessions/by-session/**", async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        patches.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ session: {} }) });
      });
      await openRecap(page, ensureLoggedIn);

      const box = page.getByRole("button", { name: "Calm after: 3", exact: true });
      await tap(box);
      await expect(box).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => patches).toEqual([{ moodMatrix: { calm: { before: null, after: 3 } } }]);

      await tap(box);
      await expect(box).toHaveAttribute("aria-pressed", "false");
      await expect.poll(() => patches).toEqual([
        { moodMatrix: { calm: { before: null, after: 3 } } },
        { moodMatrix: null },
      ]);
    });
  });
}

test.describe(`#911 Mood shift @ ${WIDE_WIDTH}px`, () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: WIDE_WIDTH, height: VIEWPORT_HEIGHT });
  });

  test("keeps BEFORE and AFTER side by side, each header and hint over its scale", async ({
    page,
    ensureLoggedIn,
  }) => {
    await openRecap(page, ensureLoggedIn);
    await expectNoHorizontalOverflow(page);

    const geometry = await measure(page);
    expect(geometry.layout).toBe("grid");
    expectEveryBoxOnScreen(geometry);

    for (const side of SIDES) {
      const header = geometry.parts[`mood-matrix-header-${side}`];
      const hint = geometry.parts[`mood-matrix-hint-${side}`];
      for (const key of MOOD_KEYS) {
        const scale = geometry.parts[`mood-matrix-scale-${key}-${side}`];
        const headerMiddle = (header.left + header.right) / 2;
        const scaleMiddle = (scale.left + scale.right) / 2;
        expect(Math.abs(headerMiddle - scaleMiddle), `${side} header centered over ${key}`).toBeLessThanOrEqual(TOLERANCE_PX);
        expectSameSpan(scale, hint, `${key} ${side} scale under its hint`);
      }
      expectHintEndsOverEndBoxes(
        geometry.hintEnds[`mood-matrix-hint-${side}`],
        geometry.boxes[`Calm ${side}: 1`],
        geometry.boxes[`Calm ${side}: 5`],
        `${side} hint`,
      );
    }
  });
});
