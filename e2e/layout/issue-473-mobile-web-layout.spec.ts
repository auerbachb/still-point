import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  expectVisibleInViewport,
} from "../utils/mobile-helpers";

// Regression coverage for #473 (mobile web layout at 320–375px). These assertions
// only need to hold on phone-width viewports; the nav reflows to a desktop layout
// above the 600px breakpoint, so the checks are scoped to mobile projects.
const NAV_LABELS = ["home", "history", "journal", "board", "friends", "settings"] as const;

test.describe("#473 mobile web layout", () => {
  test.skip(
    ({ viewport }) => !viewport || viewport.width > 600,
    "phone-width only (mobile nav / responsive board)",
  );

  test("bottom tab bar: all six labels fit and SETTINGS is not clipped", async ({
    page,
    ensureLoggedIn,
  }) => {
    await ensureLoggedIn();

    // Every nav label must be fully on-screen (no clipping past either edge) and
    // meet the 44px tap-target guideline.
    const boxes: Array<{ label: string; left: number; right: number }> = [];
    for (const label of NAV_LABELS) {
      const btn = page.getByRole("button", { name: new RegExp(`^${label}$`, "i") });
      await expectVisibleInViewport(page, btn, `${label} nav`, 1);
      await expectMinimumTapTarget(btn, `${label} nav`);
      const box = (await btn.boundingBox())!;
      boxes.push({ label, left: box.x, right: box.x + box.width });
    }

    // Adjacent labels must not overlap horizontally (the original bug crammed the
    // six uppercase words into each other so SETTINGS ran off the right edge).
    boxes.sort((a, b) => a.left - b.left);
    for (let i = 1; i < boxes.length; i += 1) {
      expect(
        boxes[i].left,
        `${boxes[i].label} should start after ${boxes[i - 1].label} ends`,
      ).toBeGreaterThanOrEqual(boxes[i - 1].right - 1);
    }

    await expectNoHorizontalOverflow(page);
  });

  test("public board: every column including CLEAR stays on-screen", async ({
    page,
    ensureLoggedIn,
  }) => {
    await ensureLoggedIn();
    await page.goto("/app/board");
    await expect(page.getByRole("heading", { name: "Practitioners" })).toBeVisible();

    // CLEAR is the right-most column and was being pushed off the viewport.
    const clearHeader = page.getByText("clear", { exact: true });
    await expectVisibleInViewport(page, clearHeader, "board CLEAR header", 1);
    await expectVisibleInViewport(page, page.getByText("91%"), "board CLEAR value", 1);
    await expectNoHorizontalOverflow(page);
  });

  test("session screen: content fits without ~2x vertical overflow", async ({
    page,
    ensureLoggedIn,
  }) => {
    await ensureLoggedIn();
    await page.goto("/app");
    const begin = page.getByRole("button", { name: "Begin" });
    await expect(begin).toBeVisible();
    // Start via a direct DOM click so the fixed bottom nav can't intercept the tap.
    await begin.evaluate((el: HTMLElement) => el.click());
    await expect(page.getByRole("button", { name: /end early/i })).toBeVisible();

    const ratio = await page.evaluate(() => {
      const docHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight,
      );
      return docHeight / window.innerHeight;
    });
    expect(ratio, "session content should not roughly double the viewport height").toBeLessThan(1.9);

    await expectNoHorizontalOverflow(page);

    // The persistent helper paragraph is collapsed on mobile to reclaim space.
    await expect(
      page.getByText(/Light distraction holds only log awareness segments/i),
    ).toHaveCount(0);
  });

  test("thought journal: reflective prompt is collapsed on mobile", async ({
    page,
    ensureLoggedIn,
  }) => {
    await ensureLoggedIn();
    await page.goto("/app/journal");
    await expect(page.getByRole("heading", { name: "Thought Journal" })).toBeVisible();
    await expect(
      page.getByText(/Every thought that felt urgent in the moment/i),
    ).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });
});
