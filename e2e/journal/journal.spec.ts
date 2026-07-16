import { test, expect } from "../fixtures/auth.fixture";
import { expectNoHorizontalOverflow } from "../utils/mobile-helpers";

test.describe("thought journal", () => {
  test("@critical lists seeded thoughts grouped by day", async ({ page, ensureLoggedIn, mockApiState }) => {
    mockApiState.thoughts = [
      {
        id: "thought-1",
        sessionId: "session-1",
        dayNumber: 2,
        timeInSession: 30,
        text: "first urgent thought",
      },
      {
        id: "thought-2",
        sessionId: "session-1",
        dayNumber: 2,
        timeInSession: 45,
        text: "second thought on day two",
      },
      {
        id: "thought-3",
        sessionId: "session-2",
        dayNumber: 1,
        timeInSession: -1,
        text: "end note reflection",
      },
    ];

    await ensureLoggedIn();
    await page.goto("/app/journal");

    await expect(page.getByRole("heading", { name: "Thought Journal" })).toBeVisible();
    await expect(page.getByText("3", { exact: true })).toBeVisible();
    await expect(page.getByText("thoughts captured")).toBeVisible();
    await expect(page.getByText("first urgent thought")).toBeVisible();
    await expect(page.getByText("second thought on day two")).toBeVisible();
    await expect(page.getByText("@30s")).toBeVisible();
    await expect(page.getByText("note", { exact: true })).toBeVisible();
    await expect(page.getByText("DAY 2")).toBeVisible();
    await expect(page.getByText("DAY 1")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("empty state when no thoughts exist", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app/journal");

    await expect(page.getByRole("heading", { name: "Thought Journal" })).toBeVisible();
    await expect(
      page.getByText("No thoughts captured yet. Complete a session to begin."),
    ).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toBeVisible();
  });

  test("nav button reaches journal tab", async ({ page, ensureLoggedIn }) => {
    await ensureLoggedIn();
    await page.goto("/app");

    await page.getByRole("button", { name: "journal" }).click();
    await expect(page).toHaveURL(/\/app\/journal$/);
    await expect(page.getByRole("heading", { name: "Thought Journal" })).toBeVisible();
  });
});
