import { expect, test } from "@playwright/test";

test.describe("critical", () => {
  test("@critical app route renders auth entrypoint", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { name: /still point/i })).toBeVisible();
  });

  test("@critical app route exposes authentication controls", async ({ page }) => {
    await page.goto("/app");
    await expect(page.getByRole("button", { name: /log in/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign up/i })).toBeVisible();
  });
});
