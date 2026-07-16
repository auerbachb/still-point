import { test, expect } from "../fixtures/auth.fixture";
import { expectNoHorizontalOverflow, expectVisibleInViewport } from "../utils/mobile-helpers";

test.describe("public board @critical", () => {
  test("@critical shows practitioner grid with current user highlighted", async ({
    page,
    ensureLoggedIn,
    mockApiState,
  }) => {
    await ensureLoggedIn();
    await page.goto("/app/board");

    await expect(page.getByRole("heading", { name: "Practitioners" })).toBeVisible();
    await expect(page.getByText("sorted by current day")).toBeVisible();

    // Mock fixture returns practitioners sorted by currentDay descending.
    await expect(page.getByText("contemplative_practitioner")).toBeVisible();
    await expect(page.getByText("128")).toBeVisible();
    await expect(page.getByText("91%")).toBeVisible();

    const youMarker = page.getByText("(you)");
    await expect(youMarker).toBeVisible();
    await expect(page.getByText(mockApiState.user.username)).toBeVisible();
    await expectVisibleInViewport(page, youMarker, "board current-user marker");
    await expectNoHorizontalOverflow(page);
  });

  test("nav button reaches board tab", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app");

    await page.getByRole("button", { name: "board" }).click();
    await expect(page).toHaveURL(/\/app\/board$/);
    await expect(page.getByRole("heading", { name: "Practitioners" })).toBeVisible();
  });
});
