import { expect, test } from "@playwright/test";

/**
 * Hits the real Next.js API (same DB as `npm run dev`) — no route mocks.
 * CI runs this lane with `POSTGRES_URL` + `JWT_SECRET` and migrations applied
 * (see `e2e/README.md`).
 */
test.describe("@authDbIntegration username uniqueness (Postgres)", () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.POSTGRES_URL?.trim(),
      "POSTGRES_URL required for @authDbIntegration (see e2e/README.md; web-e2e-auth-db job sets it).",
    );
  });
  test("second signup with case-only variant returns 409 Username already taken", async ({
    request,
  }) => {
    const rid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const email1 = `ci_u1_${rid}@stillpoint.test`;
    const email2 = `ci_u2_${rid}@stillpoint.test`;
    const usernameFirst = `Alice_${rid}`;
    const usernameSecond = usernameFirst.toLowerCase();
    const password = "password123";

    const first = await request.post("/api/auth/signup", {
      data: { email: email1, username: usernameFirst, password },
    });
    expect(first.status(), await first.text()).toBe(200);
    const firstJson = (await first.json()) as { error?: string };
    expect(firstJson.error, JSON.stringify(firstJson)).toBeUndefined();

    const second = await request.post("/api/auth/signup", {
      data: { email: email2, username: usernameSecond, password },
    });
    expect(second.status()).toBe(409);
    const secondJson = (await second.json()) as { error?: string };
    expect(secondJson.error).toBe("Username already taken");
  });

  test("parallel signup vs settings rename for same case-insensitive name yields 200+409, never 500", async ({
    browser,
  }) => {
    const rid = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const emailA = `ci_ra_${rid}@stillpoint.test`;
    const emailB = `ci_rb_${rid}@stillpoint.test`;
    const password = "password123";
    const holderUsername = `k_${rid}`;
    const targetDisplay = `T_${rid}`;
    const targetSignup = `t_${rid}`;

    const baseURL =
      process.env.E2E_BASE_URL?.trim() ||
      process.env.PLAYWRIGHT_BASE_URL?.trim() ||
      "http://127.0.0.1:3000";
    const contextA = await browser.newContext({ baseURL });
    const contextB = await browser.newContext({ baseURL });
    try {
      const requestA = contextA.request;
      const requestB = contextB.request;

      const signupA = await requestA.post("/api/auth/signup", {
        data: { email: emailA, username: holderUsername, password },
      });
      expect(signupA.status(), await signupA.text()).toBe(200);

      const patchPromise = requestA.patch("/api/settings", {
        data: { username: targetDisplay },
        headers: { "Content-Type": "application/json" },
      });
      const signupPromise = requestB.post("/api/auth/signup", {
        data: { email: emailB, username: targetSignup, password },
        headers: { "Content-Type": "application/json" },
      });

      const [patchRes, signupRes] = await Promise.all([patchPromise, signupPromise]);

      const patchStatus = patchRes.status();
      const signupStatus = signupRes.status();

      expect(patchStatus, `patch body: ${await patchRes.text()}`).not.toBe(500);
      expect(signupStatus, `signup body: ${await signupRes.text()}`).not.toBe(500);

      const statuses = new Set([patchStatus, signupStatus]);
      expect(statuses.has(200), `expected one 200, got patch=${patchStatus} signup=${signupStatus}`).toBe(
        true,
      );
      expect(statuses.has(409), `expected one 409, got patch=${patchStatus} signup=${signupStatus}`).toBe(
        true,
      );

      const conflictBody =
        patchStatus === 409 ? await patchRes.json() : signupStatus === 409 ? await signupRes.json() : null;
      expect(
        (conflictBody as { error?: string } | null)?.error,
        JSON.stringify(conflictBody),
      ).toBe("Username already taken");
    } finally {
      await Promise.allSettled([contextA.close(), contextB.close()]);
    }
  });
});
