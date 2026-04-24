import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import {
  MOBILE_SAFE_AREA_TOLERANCE_PX,
  expectMinimumTapTarget,
  expectNoVerticalOverlap,
  expectVisibleInViewport,
  tap,
} from "../utils/mobile-helpers";

async function tapWithControlReveal(page: Page, target: Locator) {
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

test.describe("mobile safe-area and bottom bar behavior", () => {
  test("home and nav controls stay visible above iOS-like bottom safe area", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();

    const beginButton = page.getByRole("button", { name: "Begin" });
    const homeNav = page.getByRole("button", { name: /^home$/i });
    await expect(beginButton).toBeVisible();
    await expect(homeNav).toBeVisible();

    await expectVisibleInViewport(page, beginButton, "home begin button");
    await expectMinimumTapTarget(beginButton, "home begin button");
    await expectMinimumTapTarget(homeNav, "home nav button");
    await expectNoVerticalOverlap(beginButton, homeNav, {
      upper: "home begin button",
      lower: "bottom home nav",
    });
  });

  test("session action row remains reachable and not hidden by browser chrome", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: "Begin" }));

    const endEarlyButton = page.getByRole("button", { name: /end early/i });
    const abandonButton = page.getByRole("button", { name: "abandon" });

    await endEarlyButton.scrollIntoViewIfNeeded();
    await expect(endEarlyButton).toBeVisible();
    await expect(abandonButton).toBeVisible();
    await expectVisibleInViewport(page, endEarlyButton, "end early button", MOBILE_SAFE_AREA_TOLERANCE_PX);
    await expectVisibleInViewport(page, abandonButton, "abandon button", MOBILE_SAFE_AREA_TOLERANCE_PX);
    await expectMinimumTapTarget(endEarlyButton, "end early button");
    await expectMinimumTapTarget(abandonButton, "abandon button");
  });

  test("no overlap between sticky mobile nav and completion return control", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: "Begin" }));
    await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));

    const returnButton = page.getByRole("button", { name: "Return" });
    const homeNav = page.getByRole("button", { name: /^home$/i });
    await expect(returnButton).toBeVisible();
    await expect(homeNav).toBeVisible();

    await expectNoVerticalOverlap(returnButton, homeNav, {
      upper: "completion return button",
      lower: "bottom home nav",
    });
    await expectVisibleInViewport(page, returnButton, "completion return button");
  });
});
