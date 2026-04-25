import { test, expect } from "../fixtures/auth.fixture";

test.describe("password reset", () => {
  test("request link and set new password from token", async ({ page, mockApiState }) => {
    let resetRequestedFor: string | null = null;
    let submittedNewPassword: string | null = null;

    await page.route("**/api/auth/password-reset/request", async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { email?: string };
      resetRequestedFor = String(body.email ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          message: "If an account exists for that email, a reset link will arrive shortly.",
        }),
      });
    });

    await page.route("**/api/auth/password-reset/confirm", async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { token?: string; password?: string };
      if (body.token !== "valid-reset-token" || !body.password || body.password.length < 8) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Reset link is invalid or expired" }),
        });
        return;
      }

      submittedNewPassword = body.password;
      mockApiState.credentials.password = body.password;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/app");
    await page.getByPlaceholder("email").fill(mockApiState.credentials.email);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/reset-password$/);
    await page.getByPlaceholder("email").fill(mockApiState.credentials.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/reset link will arrive shortly/i)).toBeVisible();
    expect(resetRequestedFor).toBe(mockApiState.credentials.email);

    await page.goto("/reset-password?token=valid-reset-token");
    await page.getByPlaceholder("new password").fill("new-password-123");
    await page.getByPlaceholder("confirm new password").fill("new-password-123");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expect(page.getByText(/password has been updated/i)).toBeVisible();
    expect(submittedNewPassword).toBe("new-password-123");

    await page.getByRole("link", { name: "Return to login" }).click();
    await page.getByPlaceholder("email").fill(mockApiState.credentials.email);
    await page.getByPlaceholder("password").fill("new-password-123");
    await page.getByRole("button", { name: "Enter" }).click();
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  });

  test("request response does not enumerate accounts", async ({ page }) => {
    const resetMessage = "If an account exists for that email, a reset link will arrive shortly.";
    const requestedEmails: string[] = [];

    await page.route("**/api/auth/password-reset/request", async (route) => {
      const body = (route.request().postDataJSON() ?? {}) as { email?: string };
      requestedEmails.push(String(body.email ?? ""));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ message: resetMessage }),
      });
    });

    await page.goto("/reset-password");
    await page.getByPlaceholder("email").fill("unknown@stillpoint.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(resetMessage)).toBeVisible();

    await page.getByPlaceholder("email").fill("known@stillpoint.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(resetMessage)).toBeVisible();
    expect(requestedEmails).toEqual(["unknown@stillpoint.test", "known@stillpoint.test"]);
  });
});
