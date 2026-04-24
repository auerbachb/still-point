import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  expectVisibleInViewport,
  simulatePullToRefreshGesture,
  tap,
} from "../utils/mobile-helpers";

test.describe("mobile session flow", () => {
  test("touch-only session complete flow has no hover dependency", async ({ page, ensureLoggedIn, mockApiState }) => {
    await ensureLoggedIn();

    const beginButton = page.getByRole("button", { name: "Begin" });
    await expectMinimumTapTarget(beginButton, "begin session button");
    await tap(beginButton);

    const lightDistraction = page.getByRole("button", { name: /light distraction/i });
    await expectMinimumTapTarget(lightDistraction, "light distraction hold button");
    await lightDistraction.dispatchEvent("touchstart");
    await page.waitForTimeout(200);
    await lightDistraction.dispatchEvent("touchend");

    const endEarlyButton = page.getByRole("button", { name: /end early/i });
    await page.dispatchEvent("body", "touchstart");
    await expectMinimumTapTarget(endEarlyButton, "end early button");
    await expectVisibleInViewport(page, endEarlyButton, "end early button");
    await tap(endEarlyButton);

    await expect(page.getByRole("heading", { name: /Day .* Complete/i })).toBeVisible();
    await expect(page.getByText(/sustained attention/i)).toBeVisible();

    const returnButton = page.getByRole("button", { name: "Return" });
    await expectMinimumTapTarget(returnButton, "return home button");
    await tap(returnButton);

    await expect(beginButton).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(mockApiState.sessions.length, "session record should be created").toBe(1);
    expect(mockApiState.sessions[0]?.completed, "end early keeps a non-complete session").toBe(false);
  });

  test("pull-to-refresh style overscroll does not break active session", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: "Begin" }));

    const pauseButton = page.getByRole("button", { name: "pause" });
    await expect(pauseButton).toBeVisible();
    await simulatePullToRefreshGesture(page);
    await page.dispatchEvent("body", "touchstart");

    await expect(page.getByRole("button", { name: /end early/i })).toBeVisible();
    await tap(page.getByRole("button", { name: /end early/i }));
    await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  });

  test("landscape smoke keeps essential controls visible", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto("/app");

    const beginButton = page.getByRole("button", { name: "Begin" });
    await expect(beginButton).toBeVisible();
    await expectVisibleInViewport(page, beginButton, "landscape begin button");
    await tap(beginButton);

    const endEarlyButton = page.getByRole("button", { name: /end early/i });
    await page.dispatchEvent("body", "touchstart");
    await expectVisibleInViewport(page, endEarlyButton, "landscape end early button");
    await tap(endEarlyButton);
    await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  });
});
