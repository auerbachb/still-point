import type { Page } from "@playwright/test";
import { test, expect, handleMockApiRequest } from "../fixtures/auth.fixture";
import { startStandInOrigin, type StandInOrigin } from "../fixtures/stand-in-origin";
import { DEFAULT_TAB, pathForTab } from "../../src/lib/appTabs";
import { OFFLINE_IDB_NAME, OFFLINE_IDB_STORE } from "../../src/lib/offlineSessionQueue/constants";
import type { PendingSessionEntry } from "../../src/lib/offlineSessionQueue/types";
import { tap, tapWithControlReveal } from "../utils/mobile-helpers";

/**
 * #666 — the installed web app has to be usable with no connection: a reload
 * lands on the normal view from the cached identity, a full sit runs and queues,
 * and reconnecting syncs it and clears the indicator.
 *
 * **Where the API comes from.** These specs let the service worker run, and
 * once it controls a page, WebKit sends that page's `fetch()` calls through it,
 * where `page.route` never sees them (#862). So the two worker specs load the
 * app from a stand-in origin of their own (`e2e/fixtures/stand-in-origin.ts`):
 * a local server in front of the dev server that answers `/api/**` from the
 * test's `mockApiState` and forwards the rest. Every request crosses it, worker
 * or not, so the same stand-in answers on every engine (#919). On Chromium the
 * fixture's `page.route` still answers first, from the same state.
 *
 * **How "offline" is simulated.** Nothing answers: the stand-in origin drops
 * every connection, so the worker falls back to its cache for documents and
 * assets, and an API abort switch layered over `page.route` makes `/api/**`
 * reject with a genuine transport error, which is what `resolveAuthBootstrap`
 * classifies as `unreachable`. The browser's own link (`context.setOffline`)
 * stays up while offline and drops and returns on reconnect, so the page still
 * gets its `online` event: on WebKit, a worker-controlled page cannot navigate
 * under `setOffline(true)` (PR #880), and these specs navigate offline.
 *
 * The worker's own fetches cross the stand-in too, so offline its route-data
 * refreshes (#967) fail like everything else and it answers from its cache.
 */

/** The connection switch, over both ways the API can answer: the auth
 *  fixture's `page.route` handler and the stand-in origin (#919). */
async function installApiOfflineSwitch(page: Page, standIn: StandInOrigin) {
  const state = { offline: false };
  // Registered after the fixture's own handler, so Playwright runs this one
  // first and can abort before the mock replies.
  await page.route("**/api/**", async (route) => {
    if (state.offline) return route.abort("internetdisconnected");
    return route.fallback();
  });
  return {
    /** Nothing answers: API calls fail at transport, and so does every
     *  document and asset fetch, which the worker then serves from its cache. */
    goOffline: () => {
      state.offline = true;
      standIn.setReachable(false);
    },
    /** Everything answers again, and the browser fires its own `online` event,
     *  as when a radio comes back. The link's drop and return are emulated here,
     *  together, rather than for the whole time offline: once a worker controls
     *  the page, WebKit fails any navigation under `context.setOffline(true)`
     *  with "WebKit encountered an internal error" (PR #880), and these specs
     *  navigate while offline. */
    goOnline: async () => {
      state.offline = false;
      standIn.setReachable(true);
      await page.context().setOffline(true);
      await page.context().setOffline(false);
    },
  };
}

type ApiOfflineSwitch = Awaited<ReturnType<typeof installApiOfflineSwitch>>;

/** Drop the connection, then reload: a launch with nothing reachable. */
async function reloadOffline(page: Page, network: ApiOfflineSwitch) {
  network.goOffline();
  await page.reload();
}

/** Home's primary action, the first thing every view in this file waits for.
 *  Matched exactly, as across the specs (#959). */
function beginButton(page: Page) {
  return page.getByRole("button", { name: "Begin", exact: true });
}

/** The banner shown while the app runs from its local copy. */
function offlineIndicator(page: Page) {
  return page.getByTestId("offline-indicator");
}

/** Home's day readout: the large day number directly above its
 *  "day · 60s · 6 blocks" caption. */
function homeDayNumber(page: Page) {
  return page.getByText(/^day · \d+s · \d+ blocks$/).locator("xpath=preceding-sibling::*[1]");
}

/** Wait until the service worker actually controls the page. Control alone does
 *  not let an offline reload boot the app: the worker precaches the HTML shell,
 *  but caches the app's scripts only as they pass through it. A spec that
 *  reloads offline therefore also needs one online load under control and then
 *  waitForAppShellCached, which primeOfflineLaunch does.
 *  Polled with expect.poll: waitForFunction does not await an async predicate,
 *  so the pending promise it returned counted as "done" on the first check. */
async function waitForServiceWorkerControl(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const registration = await navigator.serviceWorker.getRegistration("/");
      return Boolean(registration?.active) && Boolean(navigator.serviceWorker.controller);
    }), { message: "the service worker should control the page", timeout: 20_000 })
    .toBe(true);
}

/** Wait until every `/_next/static/` asset this page loaded is in Cache Storage.
 *  The dev server marks them no-store, so after an offline reload only the
 *  worker's cache can serve them, and without them the app never boots. */
async function waitForAppShellCached(page: Page) {
  await expect
    .poll(() => page.evaluate(async () => {
      const assets = performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => new URL(name).pathname.startsWith("/_next/static/"));
      const cached = await Promise.all(assets.map((url) => caches.match(url)));
      return assets.length > 0 && cached.every(Boolean);
    }), { message: "the worker should cache the app's scripts", timeout: 20_000 })
    .toBe(true);
}

/** Bring a signed-in page to the state of an installed app that has already
 *  had one online launch: the worker controls the page, then a reload runs the
 *  app's scripts through it so it caches them for an offline reload.
 *  `beforeReload` runs once the worker is in control and before that reload, so
 *  a spec can change what the online launch sees; `onReloaded` holds the spec's
 *  own readiness checks for the reloaded page, run before the cache wait. */
async function primeOfflineLaunch(
  page: Page,
  {
    beforeReload,
    onReloaded,
  }: { beforeReload?: () => void | Promise<void>; onReloaded: () => Promise<void> },
) {
  await waitForServiceWorkerControl(page);
  await beforeReload?.();
  await page.reload();
  await onReloaded();
  await waitForAppShellCached(page);
}

/** Wait until the worker holds the route data for `path` (#967). It fetches
 *  every app route's payload after an online document load, and an offline
 *  `router.push` to that route stays in the page only once it is stored.
 *  Keep the cache name and key in sync with RSC_CACHE and RSC_KEY_ORIGIN in
 *  public/sw.js. */
async function waitForRouteDataCached(page: Page, path: string) {
  await expect
    .poll(() => page.evaluate(async (routePath) => {
      const cache = await caches.open("stillpoint-rsc-v1");
      return Boolean(await cache.match(`https://still-point.internal/__rsc__${routePath}`));
    }, path), { message: `the worker should store the route data for ${path}`, timeout: 60_000 })
    .toBe(true);
}

/** Every row of the offline session queue, read straight from IndexedDB. */
function readQueuedSessions(page: Page) {
  return page.evaluate(
    ([name, store]) =>
      new Promise<PendingSessionEntry[]>((resolve, reject) => {
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
            const rows = request.result as PendingSessionEntry[];
            db.close();
            resolve(rows);
          };
          request.onerror = () => {
            db.close();
            reject(request.error ?? new Error("getAll failed"));
          };
        };
      }),
    [OFFLINE_IDB_NAME, OFFLINE_IDB_STORE] as const,
  );
}

/** Set on a document from the page, so a later check can tell it was never replaced. */
type SameDocumentMarker = Window & { __sameDocument?: boolean };

function markSameDocument(page: Page) {
  return page.evaluate(() => {
    (window as SameDocumentMarker).__sameDocument = true;
  });
}

function isSameDocument(page: Page) {
  return page.evaluate(() => (window as SameDocumentMarker).__sameDocument);
}

/** The worker specs' own origin in front of the dev server, serving the test's
 *  `mockApiState` on the network path, where WebKit's worker-controlled fetches
 *  still pass (#919). */
const workerTest = test.extend<{ standInOrigin: StandInOrigin }>({
  // Playwright requires the first argument destructured, even when empty.
  standInOrigin: async ({}, use, testInfo) => {
    const upstream = testInfo.project.use.baseURL;
    if (!upstream) throw new Error("the stand-in origin needs the project's baseURL");
    const origin = await startStandInOrigin(upstream);
    await use(origin);
    await origin.close();
  },
  baseURL: async ({ standInOrigin }, use) => {
    await use(standInOrigin.url);
  },
  mockApiState: async ({ mockApiState, standInOrigin }, use) => {
    standInOrigin.serveApi((request) => handleMockApiRequest(mockApiState, request));
    await use(mockApiState);
  },
});

test.describe("offline-first web PWA", () => {
  // These two specs test the worker, so they opt back in; the config blocks it (#862).
  test.describe(() => {
    workerTest.use({ serviceWorkers: "allow" });

    workerTest("@critical reload with no connection lands on the app, not an auth error", async ({
      page,
      ensureLoggedIn,
      mockApiState,
      standInOrigin,
    }) => {
      const network = await installApiOfflineSwitch(page, standInOrigin);
      await ensureLoggedIn();

      // The signed-in day number the offline view has to reproduce. Not the
      // sign-up default, so after the offline reload only the cached identity
      // can show it.
      const expectedDay = 12;
      const expectHomeDay = async () => {
        await expect(homeDayNumber(page)).toBeVisible();
        await expect(homeDayNumber(page)).toHaveText(String(expectedDay));
      };
      // The online launch adopts (and caches) the new day.
      await primeOfflineLaunch(page, {
        beforeReload: () => {
          mockApiState.user.currentDay = expectedDay;
        },
        onReloaded: expectHomeDay,
      });
      await waitForRouteDataCached(page, pathForTab("journal"));

      await reloadOffline(page, network);

      // The normal app, from cache — no sign-in screen, no "Unable to verify".
      await expect(beginButton(page)).toBeVisible();
      await expectHomeDay();
      await expect(page.getByText(/unable to verify your sign-in/i)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /sign up/i })).toHaveCount(0);

      // ...with the indicator up while it runs from the local copy.
      await expect(offlineIndicator(page)).toBeVisible();
      await expect(offlineIndicator(page)).toContainText(/offline/i);

      // A tab switch offline is an in-app move in this same document (#967),
      // not a full load of the destination.
      await markSameDocument(page);
      await tap(page.getByRole("button", { name: "journal", exact: true }));
      await expect(page).toHaveURL(new RegExp(`${pathForTab("journal")}$`));
      await expect(offlineIndicator(page)).toBeVisible();
      expect(await isSameDocument(page), "a tab switch offline stays in the same document").toBe(true);
    });

    workerTest("a full sit completes offline, queues, and syncs on reconnect", async ({
      page,
      ensureLoggedIn,
      mockApiState,
      standInOrigin,
    }) => {
      const network = await installApiOfflineSwitch(page, standInOrigin);
      await ensureLoggedIn();
      await primeOfflineLaunch(page, {
        onReloaded: () => expect(beginButton(page)).toBeVisible(),
      });
      await waitForRouteDataCached(page, pathForTab(DEFAULT_TAB));

      await reloadOffline(page, network);
      await expect(offlineIndicator(page)).toBeVisible();
      // Set on the offline launch's document, so every check below can tell
      // that nothing replaced it: not the return home, not the reconnect.
      await markSameDocument(page);

      // A whole sit, start to saved, with nothing reachable.
      await tap(beginButton(page));
      await tapWithControlReveal(page, page.getByRole("button", { name: /end early/i }));
      await expect(page.getByRole("heading", { name: /Complete/i })).toBeVisible();

      // It went to the offline queue rather than being lost.
      await expect.poll(async () => (await readQueuedSessions(page)).length).toBe(1);
      const [queued] = await readQueuedSessions(page);
      expect(queued, "the sit waits in the queue, not uploaded").toMatchObject({
        sessionSynced: false,
        serverSessionId: null,
      });
      expect(mockApiState.sessions.length, "nothing reached the server while offline").toBe(0);

      // Offline, the router's fetch of Home's route data fails, and the worker
      // answers it from its cache (#967), so the return home is an in-app move
      // in this same document rather than a full page load.
      await tap(page.getByRole("button", { name: "save and return to home" }));
      await expect(page).toHaveURL(new RegExp(`${pathForTab(DEFAULT_TAB)}$`));
      await expect(beginButton(page)).toBeVisible();
      await expect(offlineIndicator(page)).toBeVisible();
      expect(
        await isSameDocument(page),
        "returning home offline stays in the same document",
      ).toBe(true);

      // Back online. setOffline(false) fires the browser's own `online` event,
      // and the page's reconnect flush uploads the sit through the stand-in API.
      // It is the only uploader here: headless Chromium has Background Sync
      // disabled, so the worker's sync flush never runs, as on Safari, which has
      // no Background Sync at all.
      await network.goOnline();

      // Synced rows are pruned only on return home (#947), after that return's
      // flush, and this return ran offline, when the sit still owed its upload.
      // The reconnect flush prunes nothing, so the row stays: drained means it
      // holds its server id and owes nothing more.
      const queuedRow = async () =>
        (await readQueuedSessions(page)).find((row) => row.clientSessionId === queued.clientSessionId);
      await expect
        .poll(queuedRow)
        .toMatchObject({ sessionSynced: true, serverSessionId: expect.any(String), thoughts: [] });
      expect(
        mockApiState.sessions.map((session) => session.id),
        "the queued sit reached the server, once",
      ).toEqual([(await queuedRow())?.serverSessionId]);

      // ...and the indicator clears on its own once the bootstrap re-runs
      // successfully — no reload, no sign-in flash.
      await expect(offlineIndicator(page)).toHaveCount(0);
      await expect(beginButton(page)).toBeVisible();
      expect(
        await isSameDocument(page),
        "the page was not reloaded on reconnect",
      ).toBe(true);
    });
  });

  // No worker here, so on WebKit too the reload's /api/auth/me reaches the
  // stand-in and the 401 below comes from mockApiState, not the real server.
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
    await expect(offlineIndicator(page)).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("stillpoint_cached_user_v1")),
      "an authoritative rejection clears the cached identity",
    ).toBeNull();
  });
});
