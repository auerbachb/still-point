import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  expectVisibleInViewport,
} from "../utils/mobile-helpers";

// Regression coverage for #473 / #474 (mobile web layout at 320–375px). Widths are
// set explicitly so the spec does not depend on Playwright device presets.
const MOBILE_WIDTHS = [320, 375] as const;
const MOBILE_VIEWPORT_HEIGHT = 667;
const NAV_LABELS = ["home", "history", "journal", "board", "friends", "settings"] as const;

for (const width of MOBILE_WIDTHS) {
  test.describe(`#473 mobile web layout @ ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: MOBILE_VIEWPORT_HEIGHT });
    });

    test("bottom tab bar: icon nav fits all six labels without clipping SETTINGS", async ({
      page,
      ensureLoggedIn,
    }) => {
      await ensureLoggedIn();

      const boxes: Array<{ label: string; left: number; right: number }> = [];
      for (const label of NAV_LABELS) {
        const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
        await expect(btn.locator("svg")).toBeVisible();
        await expectVisibleInViewport(page, btn, `${label} nav`, 1);
        await expectMinimumTapTarget(btn, `${label} nav`);
        const box = (await btn.boundingBox())!;
        boxes.push({ label, left: box.x, right: box.x + box.width });
      }

      boxes.sort((a, b) => a.left - b.left);
      for (let i = 1; i < boxes.length; i += 1) {
        expect(
          boxes[i].left,
          `${boxes[i].label} should start after ${boxes[i - 1].label} ends`,
        ).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
      }

      await expectNoHorizontalOverflow(page);
    });

    test("public board: responsive grid keeps CLEAR column on-screen", async ({
      page,
      ensureLoggedIn,
    }) => {
      await ensureLoggedIn();
      await page.goto("/app/board");
      await expect(page.getByRole("heading", { name: "Practitioners" })).toBeVisible();

      const clearHeader = page.getByText("clear", { exact: true });
      await expectVisibleInViewport(page, clearHeader, "board CLEAR header", 1);
      await expectVisibleInViewport(page, page.getByText("91%"), "board CLEAR value", 1);
      await expectNoHorizontalOverflow(page);
    });

    test("immersive session: scroll resets to top so the timer is visible", async ({
      page,
      ensureLoggedIn,
    }) => {
      await ensureLoggedIn();
      await page.goto("/app");

      await page.evaluate(() => window.scrollTo(0, 900));
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

      const begin = page.getByRole("button", { name: "Begin" });
      await expect(begin).toBeVisible();
      // Direct DOM click so the fixed bottom nav cannot intercept the tap.
      await begin.evaluate((el: HTMLElement) => el.click());

      const endEarly = page.getByRole("button", { name: /end early/i });
      await expect(endEarly).toBeVisible();
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expectVisibleInViewport(page, endEarly, "session end early control", 1);

      const ratio = await page.evaluate(() => {
        const docHeight = Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight,
        );
        return docHeight / window.innerHeight;
      });
      expect(ratio, "session content should not roughly double the viewport height").toBeLessThan(1.9);
      await expectNoHorizontalOverflow(page);
    });

    test("session FlashHint: instructional copy unmounts after the brief flash", async ({
      page,
      ensureLoggedIn,
    }) => {
      await ensureLoggedIn();
      await page.goto("/app");
      const begin = page.getByRole("button", { name: "Begin" });
      await begin.evaluate((el: HTMLElement) => el.click());
      await expect(page.getByRole("button", { name: /end early/i })).toBeVisible();

      await expect(
        page.getByText(/Light distraction holds only log awareness segments/i),
      ).toHaveCount(0);
    });

    test("thought journal FlashHint: reflective prompt unmounts on mobile", async ({
      page,
      ensureLoggedIn,
    }) => {
      await ensureLoggedIn();
      await page.goto("/app/journal");
      await expect(page.getByRole("heading", { name: "Thought Journal" })).toBeVisible();
      // Wait for fetch to finish — the heading also renders during loading, before FlashHint mounts.
      await expect(page.getByText("Loading...")).toHaveCount(0);
      await expect(
        page.getByText(/Every thought that felt urgent in the moment/i),
      ).toHaveCount(0);
      await expectNoHorizontalOverflow(page);
    });
  });
}
