import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import { tap, tapWithControlReveal } from "../utils/mobile-helpers";

// #1195: the light-mode audit. Every screen the issue lists is rendered with the
// light palette (#29) at a phone and a desktop width, screenshotted full-page,
// and asserted to show its key text on a light surface. The screenshots are the
// evidence for the PR body; set LIGHT_AUDIT_DIR to keep them outside test-results.

// Runs once, on the narrow Chromium project. The three projects in
// playwright.config.ts would otherwise repeat the same two-width pass.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium-narrow", "light-mode audit runs once");
});

const WIDTHS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
} as const;

const OUT_DIR = process.env.LIGHT_AUDIT_DIR ?? path.join("test-results", "light-mode-audit");

/** Force the explicit light choice (the Settings toggle writes this key, #29). */
async function forceLight(page: Page) {
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("stillpoint_theme", "light");
    } catch {
      /* storage blocked: the page still renders its default theme */
    }
  });
}

/** The page is on the light palette: the explicit attribute is set and the body
 *  background resolves to a light colour (luminance above 0.8). */
async function expectLightSurface(page: Page) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
    .toBe("light");
  const luminance = await page.evaluate(() => {
    const m = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g)!.map(Number);
    const lin = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(m[0]) + 0.7152 * lin(m[1]) + 0.0722 * lin(m[2]);
  });
  expect(luminance, "body background is light").toBeGreaterThan(0.8);
  await expectReadableControls(page);
}

/** Field fills and control text, composited the way the browser paints them.
 *  The body check above passes even when an input turns dark grey on cream
 *  (the --overlay-bg bug), so this asserts what actually breaks: every visible
 *  field sits on a light fill, and every enabled control's text reaches 4.5:1
 *  against the fill it is painted on. Disabled controls are exempt (dimmed). */
async function expectReadableControls(page: Page) {
  const problems = await page.evaluate(() => {
    type Rgba = { r: number; g: number; b: number; a: number };
    const parse = (s: string): Rgba => {
      const m = s.match(/[\d.]+/g)!.map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
    };
    const over = (f: Rgba, b: Rgba): Rgba => ({
      r: f.r * f.a + b.r * (1 - f.a),
      g: f.g * f.a + b.g * (1 - f.a),
      b: f.b * f.a + b.b * (1 - f.a),
      a: 1,
    });
    const lum = ({ r, g, b }: Rgba) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const ratio = (a: Rgba, b: Rgba) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    // Effective paint behind an element: composite translucent ancestor
    // backgrounds down to the first opaque one, over white if none is opaque.
    const paintUnder = (el: Element): Rgba => {
      const layers: Rgba[] = [];
      for (let cur: Element | null = el; cur; cur = cur.parentElement) {
        const c = parse(getComputedStyle(cur).backgroundColor);
        if (c.a > 0) layers.push(c);
        if (c.a >= 1) break;
      }
      let base: Rgba = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
      return base;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const out: string[] = [];
    const controls = [...document.querySelectorAll("input, textarea, select, button, a[href]")].filter(visible);
    for (const el of controls) {
      const h = el as HTMLButtonElement;
      if (h.disabled) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName)
        .trim().replace(/\s+/g, " ").slice(0, 40);
      const bg = paintUnder(el);
      const isField = el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
      if (isField && lum(bg) < 0.7) out.push(`field fill is dark (${lum(bg).toFixed(2)}): ${label}`);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const r = ratio(fg, bg);
      if (r < 4.5) out.push(`control text ${r.toFixed(2)}:1 on fill: ${label}`);
    }
    const texts = [...document.querySelectorAll("h1, h2, h3, p, label")].filter(visible);
    for (const el of texts) {
      if (!el.textContent?.trim()) continue;
      const bg = paintUnder(el);
      const fg = over(parse(getComputedStyle(el).color), bg);
      const r = ratio(fg, bg);
      if (r < 4.5) {
        const label = el.textContent.trim().replace(/\s+/g, " ").slice(0, 40);
        out.push(`text ${r.toFixed(2)}:1 on paint: ${label}`);
      }
    }
    return out;
  });
  expect(problems, "readable controls on light fills").toEqual([]);
}

async function shoot(page: Page, screen: string, widthName: keyof typeof WIDTHS) {
  mkdirSync(OUT_DIR, { recursive: true });
  await page.waitForLoadState("networkidle");
  // Let mount fades and the theme transition finish, or the capture shows
  // half-faded content that is not the light palette's real contrast.
  // Only finite animations: the pulse keyframes repeat forever and never finish.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
  await page.screenshot({
    path: path.join(OUT_DIR, `${screen}-${widthName}-light.png`),
    fullPage: true,
  });
}

for (const [widthName, viewport] of Object.entries(WIDTHS) as Array<
  [keyof typeof WIDTHS, (typeof WIDTHS)[keyof typeof WIDTHS]]
>) {
  test.describe(`#1195 light mode @ ${widthName}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(viewport);
      await forceLight(page);
    });

    test("logged-out auth screen", async ({ page }) => {
      await page.goto("/app");
      await expect(page.getByRole("button", { name: "sign up" })).toBeVisible();
      await expectLightSurface(page);
      await shoot(page, "auth", widthName);
    });

    test("home", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await expect(page.getByRole("button", { name: "Begin", exact: true })).toBeVisible();
      await expectLightSurface(page);
      await shoot(page, "home", widthName);
    });

    test("session in progress", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: "Begin", exact: true }));
      await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
      // The sit is live until ended: the end-early control is on screen above.
      await expectLightSurface(page);
      await shoot(page, "session", widthName);
    });

    test("completion recap with mood matrix", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: "Begin", exact: true }));
      await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
      await expect(page.getByRole("heading", { name: /Day .* Complete/i })).toBeVisible();
      await expect(page.getByTestId("mood-matrix")).toBeVisible();
      await expectLightSurface(page);
      await shoot(page, "completion", widthName);
    });

    test("history with seeded sits", async ({ page, ensureLoggedIn, seedHistorySessions }) => {
      await ensureLoggedIn();
      await seedHistorySessions(8);
      await page.goto("/app/history");
      await expect(page.getByRole("button", { name: "settings" })).toBeVisible();
      await expectLightSurface(page);
      await shoot(page, "history", widthName);
    });

    test("public board", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await page.goto("/app/board");
      await expect(page.getByText("contemplative_practitioner")).toBeVisible();
      await expectLightSurface(page);
      await shoot(page, "board", widthName);
    });

    test("settings with theme toggle", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await page.goto("/app/settings");
      await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
      await expectLightSurface(page);
      await shoot(page, "settings", widthName);
    });

    test("privacy page", async ({ page }) => {
      await page.goto("/privacy");
      await expect(page.getByRole("heading").first()).toBeVisible();
      await expectLightSurface(page);
      await shoot(page, "privacy", widthName);
    });

    test("focus activity from home", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: /focus activity/i }));
      await expectLightSurface(page);
      await shoot(page, "focus-activity", widthName);
    });

    test("focus games from home", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: /focus games/i }));
      await expectLightSurface(page);
      await shoot(page, "focus-games", widthName);
    });

    test("breath counting from home", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: /breath counting/i }));
      await expectLightSurface(page);
      await shoot(page, "breath", widthName);
    });

    test("buddy meditation from home", async ({ page, ensureLoggedIn }) => {
      await ensureLoggedIn();
      await tap(page.getByRole("button", { name: /meditate with a friend/i }));
      await expectLightSurface(page);
      await shoot(page, "buddy", widthName);
    });

    test("reset-password page", async ({ page }) => {
      await page.goto("/reset-password");
      await expectLightSurface(page);
      await shoot(page, "reset-password", widthName);
    });
  });
}

test.describe("#1195 System theme follows the OS", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium-narrow", "light-mode audit runs once");
  });

  test("System with OS light resolves to the light palette", async ({ page, ensureLoggedIn }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await ensureLoggedIn();
    // System carries no data-theme attribute; the media query supplies the palette.
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg-rgb").trim()))
      .toBe("250, 247, 242");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBeNull();
  });

  test("System with OS dark keeps the dark palette", async ({ page, ensureLoggedIn }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await ensureLoggedIn();
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg-rgb").trim()))
      .toBe("26, 24, 22");
  });
});
