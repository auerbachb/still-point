import { test, expect } from "../fixtures/auth.fixture";
import { expectMinimumTapTarget, expectNoHorizontalOverflow, tap } from "../utils/mobile-helpers";

test.describe("signup @critical", () => {
  test("@critical signup reaches authenticated home with Begin CTA", async ({ page, mockApiState }) => {
    await page.goto("/app");
    await tap(page.getByRole("button", { name: "sign up" }));

    await page.getByPlaceholder("email").fill(mockApiState.credentials.email);
    await page.getByPlaceholder("username").fill(mockApiState.credentials.username);
    await page.getByPlaceholder("password").fill(mockApiState.credentials.password);

    const beginJourney = page.getByRole("button", { name: "Begin the journey" });
    await expectMinimumTapTarget(beginJourney, "signup submit button");
    await tap(beginJourney);

    const beginButton = page.getByRole("button", { name: "Begin" });
    await expect(beginButton).toBeVisible();
    expect(mockApiState.authenticated, "mock API should mark session authenticated after signup").toBe(true);
    await expectNoHorizontalOverflow(page);
  });
});
