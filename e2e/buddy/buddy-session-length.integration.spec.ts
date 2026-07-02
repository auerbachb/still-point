import { expect, test } from "@playwright/test";
import { BASE_DURATION, durationForDay } from "../../src/lib/constants";
import { getLocalIsoDate } from "../../src/lib/sessionCalendar";

async function signup(
  request: import("@playwright/test").APIRequestContext,
  label: string,
) {
  const rid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const email = `ci_buddy_${label}_${rid}@stillpoint.test`;
  const username = `buddy_${label}_${rid}`;
  const password = "password123";
  const response = await request.post("/api/auth/signup", {
    data: { email, username, password },
  });
  expect(response.status(), await response.text()).toBe(200);
  return { email, username, password };
}

async function advanceToDay(
  request: import("@playwright/test").APIRequestContext,
  targetDay: number,
) {
  for (let day = 1; day < targetDay; day += 1) {
    const duration = durationForDay(day);
    const response = await request.post("/api/sessions", {
      data: {
        dayNumber: day,
        sessionType: "standard",
        duration,
        completed: true,
        actualTime: duration,
        clearPercent: 80,
        thoughtCount: 0,
        mindStateLog: [],
        sessionDate: getLocalIsoDate(),
      },
    });
    expect(response.status(), await response.text()).toBe(200);
  }
}

/**
 * Real API + Postgres (#349). Same env as @authDbIntegration (see e2e/README.md).
 */
test.describe("@authDbIntegration buddy session length normalization", () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.POSTGRES_URL?.trim() || !process.env.JWT_SECRET?.trim(),
      "POSTGRES_URL and JWT_SECRET required for buddy length integration (see e2e/README.md).",
    );
  });

  test("two users with different sit lengths share the shorter buddy duration after join", async ({
    browser,
  }) => {
    const baseURL =
      process.env.E2E_BASE_URL?.trim() ||
      process.env.PLAYWRIGHT_BASE_URL?.trim() ||
      "http://127.0.0.1:3000";

    const hostDay = 5;
    const guestDay = 1;
    const expectedSeconds = Math.max(BASE_DURATION, durationForDay(guestDay));

    const hostContext = await browser.newContext({ baseURL });
    const guestContext = await browser.newContext({ baseURL });

    try {
      await signup(hostContext.request, "host");
      await advanceToDay(hostContext.request, hostDay);
      await signup(guestContext.request, "guest");

      const createRes = await hostContext.request.post("/api/buddy/sessions", {
        data: {},
      });
      expect(createRes.status(), await createRes.text()).toBe(200);
      const created = (await createRes.json()) as {
        session: { id: string; shareToken: string; durationSeconds: number };
      };
      expect(created.session.durationSeconds).toBe(durationForDay(hostDay));

      const joinRes = await guestContext.request.post("/api/buddy/sessions/join", {
        data: { token: created.session.shareToken },
      });
      expect(joinRes.status(), await joinRes.text()).toBe(200);

      const snapshotRes = await hostContext.request.get(
        `/api/buddy/sessions/${created.session.id}`,
      );
      expect(snapshotRes.status(), await snapshotRes.text()).toBe(200);
      const snapshot = (await snapshotRes.json()) as {
        snapshot: { durationSeconds: number };
      };
      expect(snapshot.snapshot.durationSeconds).toBe(expectedSeconds);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
