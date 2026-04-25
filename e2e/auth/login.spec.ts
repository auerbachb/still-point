import { test, expect } from "../fixtures/auth.fixture";
import {
  expectMinimumTapTarget,
  expectNoHorizontalOverflow,
  expectVisibleInViewport,
  tap,
} from "../utils/mobile-helpers";

test.describe("mobile auth and shell", () => {
  test("login to session shell with touch and mobile nav", async ({ page, ensureLoggedIn, mockApiState }) => {
    const auth = await ensureLoggedIn();
    mockApiState.authenticated = false;
    await page.goto("/app");

    await page.getByPlaceholder("email").fill(auth.email);
    await page.getByPlaceholder("password").fill(auth.password);

    const enterButton = page.getByRole("button", { name: "Enter" });
    await expectMinimumTapTarget(enterButton, "auth enter button");
    await tap(enterButton);

    const beginButton = page.getByRole("button", { name: "Begin" });
    await expect(beginButton).toBeVisible();
    await expectMinimumTapTarget(beginButton, "home begin button");
    await expectVisibleInViewport(page, beginButton, "home begin button");
    await expectNoHorizontalOverflow(page);

    const historyNav = page.getByRole("button", { name: /^history$/i });
    await expectMinimumTapTarget(historyNav, "history nav button");
    await tap(historyNav);
    await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();

    const settingsNav = page.getByRole("button", { name: /^settings$/i });
    await tap(settingsNav);
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  });

  test("focus stays reachable on auth inputs", async ({ page }) => {
    await page.goto("/app");

    const emailInput = page.getByPlaceholder("email");
    const passwordInput = page.getByPlaceholder("password");
    await tap(emailInput);
    await expect(emailInput).toBeFocused();
    await expectVisibleInViewport(page, emailInput, "auth email input");

    await tap(passwordInput);
    await expect(passwordInput).toBeFocused();
    await expectVisibleInViewport(page, passwordInput, "auth password input");
    await expectNoHorizontalOverflow(page);
  });

  test("401 on auth check falls back to login on narrow viewport", async ({ page }) => {
    await page.route("**/api/auth/me", async (route) => {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "Unauthorized" }),
      });
    });

    await page.goto("/app");
    await expect(page.getByPlaceholder("email")).toBeVisible();
    await expect(page.getByPlaceholder("password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });

  test("login shows deleted account errors from the API", async ({ page }) => {
    const deletedMessage = "This account has been deleted. Create a new account to continue.";
    await page.route("**/api/auth/login", async (route) => {
      await route.fulfill({
        status: 410,
        contentType: "application/json",
        body: JSON.stringify({ error: deletedMessage }),
      });
    });

    await page.goto("/app");
    await page.getByPlaceholder("email").fill("deleted@example.com");
    await page.getByPlaceholder("password").fill("password123");
    await tap(page.getByRole("button", { name: "Enter" }));

    await expect(page.getByText(deletedMessage)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("network failure on auth check shows retry contract", async ({ page }) => {
    await page.route("**/api/auth/me", async (route) => {
      await route.abort("failed");
    });

    await page.goto("/app");
    await expect(page.getByText(/network issue/i)).toBeVisible();
    const retryButton = page.getByRole("button", { name: "Retry" });
    await expect(retryButton).toBeVisible();
  });
});
