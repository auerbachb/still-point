import { test, expect } from "../fixtures/auth.fixture";
import { tap } from "../utils/mobile-helpers";

test.describe("settings logout @critical", () => {
  test("@critical logout returns to auth screen", async ({ page, ensureLoggedIn, mockApiState }) => {
    await ensureLoggedIn();
    await tap(page.getByRole("button", { name: /^settings$/i }));

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await tap(page.getByRole("button", { name: /log out/i }));

    await expect(page.getByPlaceholder("email")).toBeVisible();
    await expect(page.getByPlaceholder("password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter" })).toBeVisible();
    expect(mockApiState.authenticated, "mock API should clear auth after logout").toBe(false);
  });
});
