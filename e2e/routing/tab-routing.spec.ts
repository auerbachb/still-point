import { test, expect } from "../fixtures/auth.fixture";

// Verifies issue #292: the client-side router reflects the active tab in the
// URL, deep-linking/refresh/back-forward land on the correct tab, transient
// flows (active session) keep the tab URL intact, and the buddy invite
// query-param flow still works from any tab URL.

test.describe("tab routing reflects in URL (#292)", () => {
  test("/app resolves to the Progress tab", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app");
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  });

  test("nav buttons push per-tab routes", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app");

    await page.getByRole("button", { name: "history" }).click();
    await expect(page).toHaveURL(/\/app\/history$/);

    await page.getByRole("button", { name: "board" }).click();
    await expect(page).toHaveURL(/\/app\/board$/);

    await page.getByRole("button", { name: "settings" }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);
  });

  test("deep-linking renders the matching tab", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app/settings");
    // Settings exposes a logout control unique to that tab.
    await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
  });

  test("back/forward + refresh land on the correct tab", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app");

    await page.getByRole("button", { name: "history" }).click();
    await expect(page).toHaveURL(/\/app\/history$/);
    await page.getByRole("button", { name: "settings" }).click();
    await expect(page).toHaveURL(/\/app\/settings$/);

    await page.goBack();
    await expect(page).toHaveURL(/\/app\/history$/);

    await page.goForward();
    await expect(page).toHaveURL(/\/app\/settings$/);

    await page.reload();
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
  });

  test("unknown slug falls back to Progress", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app/not-a-real-tab");
    await expect(page).toHaveURL(/\/app\/progress$/);
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  });

  test("active session overlay keeps the tab URL intact", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app/progress");

    await page.getByRole("button", { name: "Begin" }).click();
    // Session controls render and the URL stays on the Progress tab.
    await expect(page.getByRole("button", { name: "pause" })).toBeVisible();
    await expect(page).toHaveURL(/\/app\/progress$/);
  });

  test("legacy ?view=settings deep link redirects to /app/settings", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app?view=settings");
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(page.getByRole("button", { name: /log out/i })).toBeVisible();
  });

  test("buddy invite query-param flow opens the buddy tab from any tab URL", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();

    // Mock the join endpoint (registered after the fixture, so it wins).
    await page.route("**/api/buddy/sessions/join", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "buddy-session-1", calendarSync: [] }),
      }),
    );

    await page.goto("/app/board?buddy=invite-token-abc");
    await expect(page).toHaveURL(/\/app\/buddy$/);
  });
});
