import { test, expect } from "../fixtures/auth.fixture";
import { tap } from "../utils/mobile-helpers";

// Verifies issue #292: the client-side router reflects the active tab in the
// URL, deep-linking/refresh/back-forward land on the correct tab, transient
// flows (active session) keep the tab URL intact, and the buddy invite
// query-param flow still works from any tab URL.

test.describe("tab routing reflects in URL (#292)", () => {
  test("@smoke /app resolves to the Progress tab", async ({ page, ensureLoggedIn }) => {
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

  test("buddy invite token survives email/password sign-in", async ({ page, mockApiState }) => {
    await page.route("**/api/buddy/sessions/join", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ sessionId: "buddy-session-1", calendarSync: [] }),
      }),
    );

    // Land on a standard buddy invite URL while logged out, then sign up.
    await page.goto("/app?buddy=invite-token-abc");
    await tap(page.getByRole("button", { name: "sign up" }));
    await page.getByPlaceholder("email").fill(mockApiState.credentials.email);
    await page.getByPlaceholder("username").fill(mockApiState.credentials.username);
    await page.getByPlaceholder("password").fill(mockApiState.credentials.password);
    await tap(page.getByRole("button", { name: "Begin the journey" }));

    // Sign-in must not drop the token before the buddy join effect runs.
    await expect(page).toHaveURL(/\/app\/buddy$/);
  });

  test("browser back clears a session overlay instead of desyncing from the URL", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();

    // Build history: history tab, then progress tab.
    await page.goto("/app/history");
    await expect(page).toHaveURL(/\/app\/history$/);
    await page.goto("/app/progress");
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();

    // Start a session (overlay) on the Progress tab.
    await page.getByRole("button", { name: "Begin" }).click();
    await expect(page.getByRole("button", { name: "pause" })).toBeVisible();

    // Going back must land on History with its content, not a session view
    // stuck on the wrong URL.
    await page.goBack();
    await expect(page).toHaveURL(/\/app\/history$/);
    await expect(page.getByRole("button", { name: "pause" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Progress" })).toBeVisible();
  });
});
