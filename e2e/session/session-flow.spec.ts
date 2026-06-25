import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  expectVisibleInViewport,
  simulatePullToRefreshGesture,
  tap,
  tapWithControlReveal,
} from "../utils/mobile-helpers";

test.describe("mobile session flow", () => {
  test("tracking controls remain interactive when secondary chrome dims", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: "Begin" }));

    const trackingLayer = page.locator('[data-session-tracking-layer="persistent"]');
    const secondaryChrome = page.locator('[data-session-chrome="secondary"]');
    const lightDistraction = page.getByRole("button", { name: /light distraction/i });
    const hyperfocus = page.getByRole("button", { name: /hyperfocus/i });

    await expect(trackingLayer).toBeVisible();
    await expect(secondaryChrome).toHaveAttribute("data-visibility", "dimmed");
    await expect(secondaryChrome).toHaveCSS("pointer-events", "auto");
    await expect(trackingLayer).toHaveCSS("pointer-events", "auto");

    await lightDistraction.dispatchEvent("touchstart");
    await expect(lightDistraction).toContainText("Release");
    await lightDistraction.dispatchEvent("touchend");
    await expect(lightDistraction).toContainText("Hold");

    await hyperfocus.dispatchEvent("touchstart");
    await expect(hyperfocus).toContainText("Release");
    await hyperfocus.dispatchEvent("touchend");
    await expect(hyperfocus).toContainText("Hold");
  });

  test("touch-only session complete flow has no hover dependency", async ({ page, ensureLoggedIn, mockApiState }) => {
    await ensureLoggedIn();

    const beginButton = page.getByRole("button", { name: "Begin" });
    await expectMinimumTapTarget(beginButton, "begin session button");
    await tap(beginButton);

    const lightDistraction = page.getByRole("button", { name: /light distraction/i });
    await expectMinimumTapTarget(lightDistraction, "light distraction hold button");
    await lightDistraction.dispatchEvent("touchstart");
    await expect(lightDistraction).toContainText("Release");
    await lightDistraction.dispatchEvent("touchend");
    await expect(lightDistraction).toContainText("Hold");

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

  test("quick minute saves without advancing the current day", async ({ page, ensureLoggedIn, mockApiState }) => {
    await ensureLoggedIn();

    await tap(page.getByRole("button", { name: /Quick minute/i }));
    await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));

    await expect(page.getByRole("heading", { name: "Quick Minute Complete" })).toBeVisible();
    await expect(page.getByText(/day 1 unchanged/i)).toBeVisible();
    await tap(page.getByRole("button", { name: "Return" }));

    await expect(page.getByText(/day\s+·\s+60s\s+·\s+6 blocks/i)).toBeVisible();
    expect(mockApiState.user.currentDay, "quick minute should not advance current day").toBe(1);
    expect(mockApiState.sessions[0]?.sessionType, "quick minute should be persisted as quick").toBe("quick");
  });

  test("single-tap breath session ending within first second is persisted", async ({
    page,
    ensureLoggedIn,
    mockApiState,
  }) => {
    await page.addInitScript(() => {
      Date.now = () => 1_700_000_000_000;
    });
    await ensureLoggedIn();

    await tap(page.getByRole("button", { name: "Breath counting" }));
    await expect(page.getByTestId("breath-elapsed")).toHaveText("0:00");

    await page.keyboard.press("Space");
    await tap(page.getByRole("button", { name: "End breath counting session" }));

    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
    expect(mockApiState.sessions.length, "one-tap breath session should be saved").toBe(1);
    expect(mockApiState.sessions[0]?.sessionType, "session should be persisted as breath").toBe("breath");
    expect(mockApiState.sessions[0]?.duration, "stored duration should meet API minimum").toBe(1);
    expect(mockApiState.sessions[0]?.actualTime, "raw elapsed time should remain sub-second").toBe(0);
    expect(mockApiState.sessions[0]?.breathCount, "one tap is not yet a full breath").toBe(0);
  });

  test("pull-to-refresh style overscroll does not break active session", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: "Begin" }));

    const pauseButton = page.getByRole("button", { name: "pause" });
    await expect(pauseButton).toBeVisible();
    await simulatePullToRefreshGesture(page);

    await expect(page.getByRole("button", { name: /end early/i })).toBeVisible();
    await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
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
    await expectVisibleInViewport(page, endEarlyButton, "landscape end early button");
    await tapWithControlReveal(page, endEarlyButton);
    await expect(page.getByRole("button", { name: "Return" })).toBeVisible();
  });
});
