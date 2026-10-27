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

test.describe("#960 recap return button clears the bottom nav at any recap height", () => {
  for (const [name, start] of Object.entries(STARTS)) {
    test(`when it starts ${name}`, async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: "Begin" }));
      await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));

      const returnButton = page.getByRole("button", { name: "save and return to home" });
      const navBar = page.getByTestId("app-nav");
      await expect(returnButton).toBeVisible();
      await expect(navBar).toBeVisible();
      await animationsSettled(page);

      const button = await boxAtTop(returnButton);
      const nav = await boxAtTop(navBar);
      const { width } = page.viewportSize()!;
      const height = start.viewportHeight(button, nav.height);
      await page.setViewportSize({ width, height });

      const startButton = await boxAtTop(returnButton);
      const startNav = await boxAtTop(navBar);
      expect(startNav.bottom, "the nav should sit at the bottom of the resized viewport").toBeCloseTo(height, 0);
      start.premise(startButton, { height, navTop: startNav.top });

      await expectNoVerticalOverlap(returnButton, navBar, {
        upper: "completion return button",
        lower: "bottom nav bar",
      });
      await expectVisibleInViewport(page, returnButton, "completion return button");
    });
  }
});
