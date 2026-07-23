import { test, expect } from "../fixtures/auth.fixture";
import { tap } from "../utils/mobile-helpers";

async function openSettings(page: import("@playwright/test").Page) {
  await tap(page.getByRole("button", { name: /^settings$/i }));
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test.describe("settings account deletion", () => {
  test("authenticated user can delete account and is returned to auth screen", async ({
    page,
    ensureLoggedIn,
    mockApiState,
  }) => {
    // Start as a freshly signed-up user — unique timestamped identity via the mock fixture.
    await ensureLoggedIn();

    await openSettings(page);

    // Step 1: initiate deletion (reveals the confirmation step).
    const triggerBtn = page.getByTestId("delete-account-trigger");
    await tap(triggerBtn);

    // Step 2: confirm deletion — this calls DELETE /api/account, then logout + onLogout.
    const confirmBtn = page.getByTestId("delete-account-confirm");
    await expect(confirmBtn).toBeVisible();
    await tap(confirmBtn);

    // Verify the app returned to the unauthenticated auth screen.
    await expect(page.getByPlaceholder("email")).toBeVisible();
    await expect(page.getByPlaceholder("password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter" })).toBeVisible();

    // Verify mock API state cleared authentication.
    expect(mockApiState.authenticated, "mock API should clear auth after account deletion").toBe(false);

    // Verify GET /api/auth/me now returns 401 — the session is fully invalidated.
    const meStatus = await page.evaluate(() =>
      fetch("/api/auth/me").then((r) => r.status)
    );
    expect(meStatus, "/api/auth/me should return 401 after account deletion").toBe(401);
  });

  test("confirm step can be cancelled without deleting the account", async ({
    page,
    ensureLoggedIn,
    mockApiState,
  }) => {
    await ensureLoggedIn();

    await openSettings(page);

    // Initiate deletion, then cancel — account should remain intact.
    await tap(page.getByTestId("delete-account-trigger"));
    await expect(page.getByTestId("delete-account-confirm")).toBeVisible();

    await tap(page.getByRole("button", { name: /cancel/i }));

    // The trigger button should re-appear (back to the pre-confirm state).
    await expect(page.getByTestId("delete-account-trigger")).toBeVisible();

    // Auth state must be unaffected.
    expect(mockApiState.authenticated, "mock API should still be authenticated after cancel").toBe(true);
  });
});
