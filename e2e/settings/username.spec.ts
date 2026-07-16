import { test, expect } from "../fixtures/auth.fixture";
import { tap } from "../utils/mobile-helpers";
import { USERNAME_ERROR } from "../../src/lib/username";

async function openSettings(page: import("@playwright/test").Page) {
  await tap(page.getByRole("button", { name: /^settings$/i }));
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

test.describe("settings username @critical", () => {
  test("@critical inline edit succeeds", async ({ page, ensureLoggedIn, mockApiState }) => {
    await ensureLoggedIn();
    await openSettings(page);

    await tap(page.getByRole("button", { name: "Edit username" }));
    const field = page.getByRole("textbox", { name: "Username" });
    await field.fill("renamed_user");
    await tap(page.getByRole("button", { name: "save" }));

    await expect(page.getByText("Username updated")).toBeVisible();
    await expect(page.locator("div").filter({ hasText: "ACCOUNT" }).getByText("renamed_user", { exact: true })).toBeVisible();
    expect(mockApiState.user.username).toBe("renamed_user");
    expect(mockApiState.credentials.username).toBe("renamed_user");
  });

  test("validation error for too-short username", async ({ page, ensureLoggedIn, mockApiState }) => {
    const original = mockApiState.user.username;
    await ensureLoggedIn();
    await openSettings(page);

    await tap(page.getByRole("button", { name: "Edit username" }));
    await page.getByRole("textbox", { name: "Username" }).fill("ab");
    await tap(page.getByRole("button", { name: "save" }));

    await expect(page.getByText(USERNAME_ERROR)).toBeVisible();
    expect(mockApiState.user.username).toBe(original);
  });

  test("conflict shows taken message", async ({ page, ensureLoggedIn, mockApiState }) => {
    const original = mockApiState.user.username;
    await ensureLoggedIn();
    await openSettings(page);

    await tap(page.getByRole("button", { name: "Edit username" }));
    await page.getByRole("textbox", { name: "Username" }).fill("taken_name");
    await tap(page.getByRole("button", { name: "save" }));

    await expect(page.getByText(/already taken/i)).toBeVisible();
    expect(mockApiState.user.username).toBe(original);
  });
});
