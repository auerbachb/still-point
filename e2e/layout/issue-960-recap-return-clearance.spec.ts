import type { Locator, Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import {
  expectNoVerticalOverlap,
  expectVisibleInViewport,
  tap,
  tapWithControlReveal,
} from "../utils/mobile-helpers";

// #960: where the recap's return button first lands depends on how tall the
// recap is, and that changes with the fonts, the phone and what the sit
// captured. One fixed viewport passes or fails by luck: dropping the rating
// sliders (#889) broke safe-area.spec.ts on CI WebKit, and stacking the Mood
// Shift grid (#911) hid it again. So each test measures the button, then sizes
// the viewport so it starts in one of the two places that put it under the nav.
// "The nav" is the whole fixed bar, its top padding included, not just a tab.
type Start = {
  /** Viewport height for this start, from the button's top and bottom at scroll 0. */
  viewportHeight: (button: { top: number; bottom: number }, navHeight: number) => number;
  /** Confirms the button really starts there, so the test checks what it says. */
  premise: (button: { top: number; bottom: number }, viewport: { height: number; navTop: number }) => void;
};

const STARTS: Record<string, Start> = {
  // Partly on screen: WebKit scrolls its bottom edge to the viewport's bottom.
  "straddling the bottom edge": {
    viewportHeight: ({ top, bottom }) => Math.round((top + bottom) / 2),
    premise: ({ top, bottom }, { height }) => {
      expect(top, "button top should start on screen").toBeLessThan(height);
      expect(bottom, "button bottom should start below the viewport").toBeGreaterThan(height);
    },
  },
  // Wholly on screen but behind the nav: nothing scrolls it at all.
  "on screen behind the nav": {
    viewportHeight: ({ bottom }, navHeight) => Math.ceil(bottom + navHeight / 2),
    premise: ({ top, bottom }, { height, navTop }) => {
      expect(top, "button should start wholly on screen").toBeGreaterThanOrEqual(0);
      expect(bottom, "button should start wholly on screen").toBeLessThanOrEqual(height);
      expect(bottom, "button should start behind the nav").toBeGreaterThan(navTop + 1);
    },
  },
};

/** Resolves once every finite animation (the recap's fade-in) has finished. */
async function animationsSettled(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
        .map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
}

/** Scrolls the page to the top and returns the element's box there. */
async function boxAtTop(target: Locator) {
  return target.evaluate((element) => {
    window.scrollTo(0, 0);
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  });
}

/**
 * #979: the return button is pinned with `position: sticky`, so its live box
 * at scroll 0 is already shifted above the nav. The starts must describe where
 * it sits in normal flow, so this reads the box with the pin switched off.
 */
async function inFlowBoxAtTop(target: Locator) {
  return target.evaluate((element) => {
    window.scrollTo(0, 0);
    const el = element as HTMLElement;
    const pinned = el.style.position;
    el.style.position = "static";
    const rect = el.getBoundingClientRect();
    el.style.position = pinned;
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  });
}

/** Begin a sit, end it early and wait until the recap is fully rendered. */
async function openRecap(page: Page, ensureLoggedIn: () => Promise<unknown>) {
  await ensureLoggedIn();
  await tap(page.getByRole("button", { name: "Begin", exact: true }));
  await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
  await expect(page.getByTestId("completion-return-bottom")).toBeVisible();
  await expect(page.getByTestId("mood-matrix")).toBeVisible();
  await animationsSettled(page);
}

test.describe("#960 recap return button clears the bottom nav at any recap height", () => {
  for (const [name, start] of Object.entries(STARTS)) {
    test(`when it starts ${name}`, async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: "Begin", exact: true }));
      await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));

      const returnButton = page.getByTestId("completion-return-bottom");
      const navBar = page.getByTestId("app-nav");
      await openRecap(page, ensureLoggedIn);
      await expect(navBar).toBeVisible();

      const button = await inFlowBoxAtTop(returnButton);
      const nav = await boxAtTop(navBar);
      const { width } = page.viewportSize()!;
      const height = start.viewportHeight(button, nav.height);
      await page.setViewportSize({ width, height });

      const startButton = await inFlowBoxAtTop(returnButton);
      const startNav = await boxAtTop(navBar);
      expect(startNav.bottom, "the nav should sit at the bottom of the resized viewport").toBeCloseTo(height, 0);
      start.premise(startButton, { height, navTop: startNav.top });

      // #979: measured live, at scroll 0, before any scroll-into-view call.
      const atStart = await page.evaluate(() => {
        const buttonRect = document.querySelector('[data-testid="completion-return-bottom"]')!.getBoundingClientRect();
        const navRect = document.querySelector('[data-testid="app-nav"]')!.getBoundingClientRect();
        return { scrollY: window.scrollY, buttonTop: buttonRect.top, buttonBottom: buttonRect.bottom, navTop: navRect.top };
      });
      expect(atStart.scrollY, "the page should start at scroll 0").toBe(0);
      expect(atStart.buttonTop, "the pinned button should start on screen").toBeGreaterThanOrEqual(0);
      expect(atStart.buttonBottom, "the pinned button should clear the nav at scroll 0").toBeLessThanOrEqual(atStart.navTop);

      await expectNoVerticalOverlap(returnButton, navBar, {
        upper: "completion return button",
        lower: "bottom nav bar",
      });
      await expectVisibleInViewport(page, returnButton, "completion return button");
    });
  }

  test("at the document end the recap content scrolls clear of the pinned button and the nav", async ({
    page,
    ensureLoggedIn,
  }) => {
    const { width } = page.viewportSize()!;
    await page.setViewportSize({ width, height: 568 });
    await openRecap(page, ensureLoggedIn);

    const returnButton = page.getByTestId("completion-return-bottom");
    const navBar = page.getByTestId("app-nav");
    const grid = page.getByTestId("mood-matrix");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight))
      .toBe(true);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect
      .poll(() => page.evaluate(() => {
        const root = document.documentElement;
        return root.scrollHeight - root.clientHeight - root.scrollTop <= 1;
      }), { message: "the page should scroll to its end" })
      .toBe(true);

    const gridBox = await grid.boundingBox();
    const buttonBox = await returnButton.boundingBox();
    const navBox = await navBar.boundingBox();
    expect(gridBox && buttonBox && navBox).toBeTruthy();
    expect(gridBox!.y + gridBox!.height, "the Mood shift grid should clear the pinned button").toBeLessThanOrEqual(buttonBox!.y + 1);
    expect(buttonBox!.y + buttonBox!.height, "the button should clear the nav at the end").toBeLessThanOrEqual(navBox!.y + 1);
  });

  test("the desktop recap keeps its return button in flow", async ({ page, ensureLoggedIn }) => {
    const { height } = page.viewportSize()!;
    await page.setViewportSize({ width: 768, height });
    await openRecap(page, ensureLoggedIn);

    const position = await page.getByTestId("completion-return-bottom").evaluate((el) => getComputedStyle(el).position);
    expect(position).not.toBe("sticky");
  });
});
