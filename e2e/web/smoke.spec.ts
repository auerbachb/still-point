import { expect, test } from "@playwright/test";

test.describe("Landing page smoke @smoke @critical", () => {
  test("loads with primary CTAs", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: /train attention/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open App" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Login" })).toBeVisible();
  });
});
