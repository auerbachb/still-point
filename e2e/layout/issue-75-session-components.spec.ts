import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import { tap } from "../utils/mobile-helpers";

// #75: each Settings "Session screen" toggle hides its session component. The
// countdown is never hidden; minimal view (#669) hides every optional component
// whatever the saved toggles say; a stored preference missing the #75 keys reads
// as visible.
const PREFS_KEY = "stillpoint_display_prefs";
const MINIMAL_KEY = "stillpoint_minimal_session_view";
const COMPONENTS = {
  blockGrid: "block-grid",
  progressBar: "progress-bar",
  mindStateBar: "mind-state-bar",
} as const;

/** Writes the display prefs (or leaves them unset) and the minimal-view pref before each page load. */
async function seed(page: Page, prefs: Record<string, boolean> | null, minimal = false) {
  await page.addInitScript(
    ([prefsKey, prefsJson, minimalKey, minimalValue]) => {
      if (prefsJson !== null) localStorage.setItem(prefsKey, prefsJson);
      localStorage.setItem(minimalKey, minimalValue);
    },
    [PREFS_KEY, prefs === null ? null : JSON.stringify(prefs), MINIMAL_KEY, String(minimal)] as const,
  );
}

async function beginSit(page: Page, ensureLoggedIn: () => Promise<unknown>) {
  await ensureLoggedIn();
  await tap(page.getByRole("button", { name: "Begin", exact: true }));
  await expect(page.locator("[data-session-timer-digits]")).toBeVisible();
}

function component(page: Page, name: string) {
  return page.locator(`[data-session-component="${name}"]`);
}

test.describe("#75 session-screen component toggles", () => {
  test("defaults show every optional component", async ({ page, ensureLoggedIn }) => {
    await seed(page, null);
    await beginSit(page, ensureLoggedIn);
    await expect(component(page, COMPONENTS.blockGrid)).toHaveCount(1);
    await expect(component(page, COMPONENTS.progressBar)).toHaveCount(1);
    await expect(component(page, COMPONENTS.mindStateBar)).toHaveCount(1);
  });

  test("a stored preference missing the #75 keys resolves to visible", async ({ page, ensureLoggedIn }) => {
    await seed(page, null);
    await page.addInitScript((key) => {
      localStorage.setItem(key, JSON.stringify({ showTimer: true, sandAnimation: false }));
    }, PREFS_KEY);
    await beginSit(page, ensureLoggedIn);
    await expect(component(page, COMPONENTS.blockGrid)).toHaveCount(1);
    await expect(component(page, COMPONENTS.progressBar)).toHaveCount(1);
    await expect(component(page, COMPONENTS.mindStateBar)).toHaveCount(1);
  });

  for (const [prefKey, name] of [
    ["showBlockGrid", COMPONENTS.blockGrid],
    ["showProgressBar", COMPONENTS.progressBar],
    ["showMindStateBar", COMPONENTS.mindStateBar],
  ] as const) {
    test(`${prefKey}=false hides only its component and keeps the countdown`, async ({ page, ensureLoggedIn }) => {
      await seed(page, { showTimer: true, sandAnimation: false, showBlockGrid: true, showProgressBar: true, showMindStateBar: true, [prefKey]: false });
      await beginSit(page, ensureLoggedIn);
      await expect(component(page, name)).toHaveCount(0);
      for (const other of Object.values(COMPONENTS).filter((c) => c !== name)) {
        await expect(component(page, other)).toHaveCount(1);
      }
      await expect(page.locator("[data-session-timer-digits]")).toBeVisible();
    });
  }

  test("all three toggles off leaves only the countdown and its controls", async ({ page, ensureLoggedIn }) => {
    await seed(page, { showTimer: true, sandAnimation: false, showBlockGrid: false, showProgressBar: false, showMindStateBar: false });
    await beginSit(page, ensureLoggedIn);
    for (const name of Object.values(COMPONENTS)) {
      await expect(component(page, name)).toHaveCount(0);
    }
    await expect(page.locator("[data-session-timer-digits]")).toBeVisible();
  });

  test("minimal view hides every optional component even with the toggles on", async ({ page, ensureLoggedIn }) => {
    await seed(page, { showTimer: true, sandAnimation: false, showBlockGrid: true, showProgressBar: true, showMindStateBar: true }, true);
    await beginSit(page, ensureLoggedIn);
    for (const name of Object.values(COMPONENTS)) {
      await expect(component(page, name)).toHaveCount(0);
    }
    await expect(page.locator("[data-session-timer-digits]")).toBeVisible();
  });
});
