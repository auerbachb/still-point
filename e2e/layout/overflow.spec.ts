import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  expectVisibleInViewport,
  tapWithControlReveal,
  tap,
} from "../utils/mobile-helpers";

/** Bounding box without scrolling the target into view first. */
async function boxOf(target: Locator, label: string) {
  const box = await target.boundingBox();
  expect(box, `${label} should expose a bounding box`).not.toBeNull();
  return box!;
}

/** Whether the document has scrolled at all, and whether it is at its end. */
function pageScroll(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return {
      scrolled: root.scrollTop > 0,
      atEnd: root.scrollHeight - root.clientHeight - root.scrollTop <= 1,
    };
  });
}

test.describe("mobile overflow and scrolling", () => {
  test("auth and home screens avoid horizontal overflow", async ({ page, ensureLoggedIn }) => {
    await page.goto("/app");
    await expectNoHorizontalOverflow(page);
    await expectVisibleInViewport(page, page.getByRole("button", { name: "Enter" }), "auth enter button");

    await ensureLoggedIn();
    await expectNoHorizontalOverflow(page);
    await expectVisibleInViewport(page, page.getByRole("button", { name: "Begin", exact: true }), "home begin button");
  });

  test("history long list scrolls and sticky nav does not permanently cover rows", async ({
    page,
    ensureLoggedIn,
    seedHistorySessions,
  }) => {
    const seededSits = 24;
    await ensureLoggedIn();
    await seedHistorySessions(seededSits);
    await page.goto("/app");

    await tap(page.getByRole("button", { name: /^history$/i }));
    const progressHeading = page.getByRole("heading", { name: "Progress" });
    await expect(progressHeading).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // Progress opens on the calendar; the per-sit rows are the "Session buildup" view.
    await tap(page.getByRole("button", { name: "Session buildup", exact: true }));
    // One standard sit per calendar day → each row is "Session 1", oldest first.
    const sessionLabels = page.getByText(/^Session 1$/);
    await expect(sessionLabels, "every seeded sit should reach the list").toHaveCount(seededSits);
    await expectNoHorizontalOverflow(page);

    const latestRow = sessionLabels.last().locator("..");
    // The whole fixed bar, not just the Home button inside its padding.
    const bottomNav = page.getByRole("button", { name: /^home$/i }).locator("..");
    const progressScreen = progressHeading.locator("..");
    const viewport = page.viewportSize();
    expect(viewport, "viewport size should be available").not.toBeNull();

    const rowAtTop = await boxOf(latestRow, "latest history session row");
    const navAtTop = await boxOf(bottomNav, "bottom nav");
    expect(
      rowAtTop.y + rowAtTop.height,
      "the latest row should start out under the nav or below the fold",
    ).toBeGreaterThan(navAtTop.y);

    // Scroll to the end of the page (mobile WebKit has no mouse.wheel) and let it
    // settle. The shared viewport helpers scroll their target into view first,
    // which would hide a row the nav covers, so the checks below use boundingBox().
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(() => pageScroll(page), { message: "the page should scroll to its end" })
      .toMatchObject({ scrolled: true, atEnd: true });

    const nav = await boxOf(bottomNav, "bottom nav");
    const row = await boxOf(latestRow, "latest history session row");
    const screen = await boxOf(progressScreen, "Progress screen");
    expect(
      Math.abs(nav.y + nav.height - viewport!.height),
      "the nav should stay pinned to the bottom",
    ).toBeLessThanOrEqual(1);
    expect(row.y, "latest history session row should not render above viewport").toBeGreaterThanOrEqual(0);
    expect(row.y + row.height, "latest history session row should clear the bottom nav").toBeLessThanOrEqual(nav.y + 1);
    expect(
      screen.y + screen.height,
      "the end of the Progress screen should clear the bottom nav",
    ).toBeLessThanOrEqual(nav.y + 1);
    expect(await pageScroll(page), "measuring should not have moved the page").toMatchObject({ atEnd: true });
  });

  test("critical buttons meet 44px tap target guideline", async ({ page, ensureLoggedIn }) => {
    await page.goto("/app");
    const enterButton = page.getByRole("button", { name: "Enter" });
    await expectMinimumTapTarget(enterButton, "auth enter button");

    await ensureLoggedIn();
    const beginButton = page.getByRole("button", { name: "Begin", exact: true });
    await expectMinimumTapTarget(beginButton, "home begin button");

    await tap(beginButton);
    const endEarlyButton = page.getByRole("button", { name: /end early/i });
    await expectMinimumTapTarget(endEarlyButton, "session end early button");

    await tapWithControlReveal(page, endEarlyButton);
    const returnButton = page.getByRole("button", { name: "save and return to home" });
    await expect(returnButton).toBeVisible();
    await expectMinimumTapTarget(returnButton, "completion return button");
  });

  test("zoom-like font scaling at 120 percent keeps home layout stable", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.addStyleTag({
      content: "html { font-size: 120% !important; }",
    });

    await expect(page.getByRole("button", { name: "Begin", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page, 2);
    await expectVisibleInViewport(page, page.getByRole("button", { name: "Begin", exact: true }), "scaled begin button");
  });
});
