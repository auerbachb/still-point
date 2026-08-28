import { test, expect } from "../fixtures/auth.fixture";
import { OFFLINE_IDB_NAME, OFFLINE_IDB_STORE } from "../../src/lib/offlineSessionQueue/constants";
import { tap, tapWithControlReveal } from "../utils/mobile-helpers";

/**
 * #666 — the installed web app has to be usable with no connection: a reload
 * lands on the normal view from the cached identity, a full sit runs and queues,
 * and reconnecting syncs it and clears the indicator.
 *
 * **How "offline" is simulated.** The auth fixture serves the whole API from
 * `page.route`, which intercepts *before* the network — so `setOffline(true)`
 * alone would leave the mocked API answering happily. Offline here is therefore
 * two things at once: `context.setOffline(true)` (so `navigator.onLine` is false
 * and the document/asset fetches go through the service worker) and an API
 * abort switch (so `/api/**` rejects with a genuine transport error, which is
 * what `resolveAuthBootstrap` classifies as `unreachable`). Both flip back
 * together on reconnect.
 */

/** Route-level kill switch for the mocked API, layered over the auth fixture. */
async function installApiOfflineSwitch(page: import("@playwright/test").Page) {
  const state = { offline: false };
  // Registered after the fixture's own handler, so Playwright runs this one
  // first and can abort before the mock replies.
  await page.route("**/api/**", async (route) => {
    if (state.offline) return route.abort("internetdisconnected");
    return route.fallback();
  });
  return {
    goOffline: async () => {
      state.offline = true;
      await page.context().setOffline(true);
    },
    goOnline: async () => {
      state.offline = false;
      await page.context().setOffline(false);
    },
  };
}

/** Wait until the service worker actually controls the page, so a reload with
 *  the network off is served from the precached app shell rather than failing. */
async function waitForServiceWorkerControl(page: import("@playwright/test").Page) {
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.getRegistration("/");
    return Boolean(registration?.active) && Boolean(navigator.serviceWorker.controller);
  }, undefined, { timeout: 20_000 });
}

function readQueuedSessions(page: import("@playwright/test").Page, dbName: string, storeName: string) {
  return page.evaluate(
    ([name, store]) =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error ?? new Error("open failed"));
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(store)) {
            db.close();
            resolve([]);
            return;
          }
          const request = db.transaction(store, "readonly").objectStore(store).getAll();
          request.onsuccess = () => {
            const rows = request.result as Array<Record<string, unknown>>;
            db.close();
            resolve(rows);
          };
          request.onerror = () => {
            db.close();
            reject(request.error ?? new Error("getAll failed"));
          };
        };
      }),
    [dbName, storeName] as const,
  );
}

test.describe("offline-first web PWA", () => {
  test("@critical reload with no connection lands on the app, not an auth error", async ({
    page,
    ensureLoggedIn,
    mockApiState,
  }) => {
    const network = await installApiOfflineSwitch(page);
    await ensureLoggedIn();
    await waitForServiceWorkerControl(page);

    // The signed-in day number the offline view has to reproduce.
    const expectedDay = mockApiState.user.currentDay;
    await expect(page.getByText(new RegExp(`Day\\s*${expectedDay}\\b`, "i")).first()).toBeVisible();

    await network.goOffline();
    await page.reload();

    // The normal app, from cache — no sign-in screen, no "Unable to verify".
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
    await expect(page.getByText(new RegExp(`Day\\s*${expectedDay}\\b`, "i")).first()).toBeVisible();
    await expect(page.getByText(/unable to verify your sign-in/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /sign up/i })).toHaveCount(0);

    // ...with the indicator up while it runs from the local copy.
    await expect(page.getByTestId("offline-indicator")).toBeVisible();
    await expect(page.getByTestId("offline-indicator")).toContainText(/offline/i);
  });

  test("a full sit completes offline, queues, and syncs on reconnect", async ({
    page,
    ensureLoggedIn,
    mockApiState,
  }) => {
    const network = await installApiOfflineSwitch(page);
    await ensureLoggedIn();
    await waitForServiceWorkerControl(page);

    await network.goOffline();
    await page.reload();
    await expect(page.getByTestId("offline-indicator")).toBeVisible();

    // A whole sit, start to saved, with nothing reachable.
    await tap(page.getByRole("button", { name: "Begin" }));
    await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
    await expect(page.getByRole("heading", { name: /Complete/i })).toBeVisible();

    // It went to the offline queue rather than being lost.
    await expect
      .poll(async () => (await readQueuedSessions(page, OFFLINE_IDB_NAME, OFFLINE_IDB_STORE)).length)
      .toBeGreaterThan(0);
    expect(mockApiState.sessions.length, "nothing reached the server while offline").toBe(0);

    await tap(page.getByRole("button", { name: "Return" }));

    // Back online: the queue drains, and the indicator clears on its own once
    // the bootstrap re-runs successfully — no reload, no sign-in flash.
    await network.goOnline();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect
      .poll(async () => (await readQueuedSessions(page, OFFLINE_IDB_NAME, OFFLINE_IDB_STORE)).length)
      .toBe(0);
    expect(mockApiState.sessions.length, "the queued sit reached the server").toBeGreaterThan(0);
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Begin" })).toBeVisible();
  });

  test("a rejected session still signs you out, unlike a dead network", async ({
    page,
    ensureLoggedIn,
    mockApiState,
  }) => {
    await ensureLoggedIn();

    // A real 401 from the server — the one answer that proves the session is over.
    mockApiState.authenticated = false;
    await page.reload();

    await expect(page.getByRole("button", { name: /sign up/i })).toBeVisible();
    await expect(page.getByTestId("offline-indicator")).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("stillpoint_cached_user_v1")),
      "an authoritative rejection clears the cached identity",
    ).toBeNull();
  });
});
