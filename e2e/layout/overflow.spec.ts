import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  expectNoVerticalOverlap,
  expectVisibleInViewport,
  tap,
} from "../utils/mobile-helpers";

async function tapWithControlReveal(page: Parameters<typeof test>[0]["page"], target: Parameters<typeof tap>[0]) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.dispatchEvent("body", "touchstart");
    try {
      await tap(target);
      return;
    } catch (error) {
      lastError = error;
      await page.waitForTimeout(120);
    }
  }
  throw lastError;
}

test.describe("mobile overflow and scrolling", () => {
  test("auth and home screens avoid horizontal overflow", async ({ page, ensureLoggedIn }) => {
    await page.goto("/app");
    await expectNoHorizontalOverflow(page);
    await expectVisibleInViewport(page, page.getByRole("button", { name: "Enter" }), "auth enter button");

    await ensureLoggedIn();
    await expectNoHorizontalOverflow(page);
    await expectVisibleInViewport(page, page.getByRole("button", { name: "Begin" }), "home begin button");
  });

  test("history long list scrolls and sticky nav does not permanently cover rows", async ({
    page,
    ensureLoggedIn,
    seedHistorySessions,
  }) => {
    await ensureLoggedIn();
    await seedHistorySessions(24);
    await page.goto("/app");

    await tap(page.getByRole("button", { name: /^history$/i }));
    await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const firstEntry = page.getByText(/^D1$/).first();
    const lastEntry = page.getByText(/^D24$/).last();
    await expect(firstEntry).toBeVisible();
    await expect(lastEntry).toHaveCount(1);

    await lastEntry.scrollIntoViewIfNeeded();
    await expectVisibleInViewport(page, lastEntry, "latest history day chip");
    await expectNoVerticalOverlap(lastEntry, page.getByRole("button", { name: /^home$/i }), {
      upper: "latest history day chip",
      lower: "bottom home nav",
    });
  });

  test("critical buttons meet 44px tap target guideline", async ({ page, ensureLoggedIn }) => {
    await page.goto("/app");
    const enterButton = page.getByRole("button", { name: "Enter" });
    await expectMinimumTapTarget(enterButton, "auth enter button");

    await ensureLoggedIn();
    const beginButton = page.getByRole("button", { name: "Begin" });
    await expectMinimumTapTarget(beginButton, "home begin button");

    await tap(beginButton);
    const endEarlyButton = page.getByRole("button", { name: /end early/i });
    await expectMinimumTapTarget(endEarlyButton, "session end early button");

    await tapWithControlReveal(page, endEarlyButton);
    const returnButton = page.getByRole("button", { name: "Return" });
    await expect(returnButton).toBeVisible();
    await expectMinimumTapTarget(returnButton, "completion return button");
  });

  test("zoom-like font scaling at 120 percent keeps home layout stable", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.addStyleTag({
      content: "html { font-size: 120% !important; }",
    });

    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
    await expectNoHorizontalOverflow(page, 2);
    await expectVisibleInViewport(page, page.getByRole("button", { name: "Begin" }), "scaled begin button");
  });
});
