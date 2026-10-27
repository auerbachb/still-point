import type { Page } from "@playwright/test";
import { test, expect } from "../fixtures/auth.fixture";
import { DEFAULT_TAB, pathForTab } from "../../src/lib/appTabs";
import { OFFLINE_IDB_NAME, OFFLINE_IDB_STORE } from "../../src/lib/offlineSessionQueue/constants";
import type { PendingSessionEntry } from "../../src/lib/offlineSessionQueue/types";
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

/** Route-level kill switch for the mocked API, layered over the auth fixture.
 *  `goOffline` and `goOnline` flip both halves of "offline" together. */
async function installApiOfflineSwitch(page: Page) {
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

type ApiOfflineSwitch = Awaited<ReturnType<typeof installApiOfflineSwitch>>;

/** Drop the connection, then reload: a launch with nothing reachable. */
async function reloadOffline(page: Page, network: ApiOfflineSwitch) {
  await network.goOffline();
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

test.describe("offline-first web PWA", () => {
  // These two specs test the worker, so they opt back in; the config blocks it (#862).
  // On WebKit the worker then hides their API calls from page.route, so both skip
  // there; #919 tracks it.
  test.describe(() => {
    test.use({ serviceWorkers: "allow" });
    test.skip(
      ({ browserName }) => browserName === "webkit",
      "WebKit hides a worker-controlled page's API calls from page.route, and an offline reload " +
        "throws there (PR #880); tracked in #919",
    );

    test("@critical reload with no connection lands on the app, not an auth error", async ({
      page,
      ensureLoggedIn,
      mockApiState,
    }) => {
      const network = await installApiOfflineSwitch(page);
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

      await reloadOffline(page, network);

      // The normal app, from cache — no sign-in screen, no "Unable to verify".
      await expect(beginButton(page)).toBeVisible();
      await expectHomeDay();
      await expect(page.getByText(/unable to verify your sign-in/i)).toHaveCount(0);
      await expect(page.getByRole("button", { name: /sign up/i })).toHaveCount(0);

      // ...with the indicator up while it runs from the local copy.
      await expect(offlineIndicator(page)).toBeVisible();
      await expect(offlineIndicator(page)).toContainText(/offline/i);
    });

    test("a full sit completes offline, queues, and syncs on reconnect", async ({
      page,
      ensureLoggedIn,
      mockApiState,
    }) => {
      const network = await installApiOfflineSwitch(page);
      await ensureLoggedIn();
      await primeOfflineLaunch(page, {
        onReloaded: () => expect(beginButton(page)).toBeVisible(),
      });

      await reloadOffline(page, network);
      await expect(offlineIndicator(page)).toBeVisible();

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

      // Offline, the router cannot fetch Home's server payload, so Next.js falls
      // back to a full load of the page, which the worker serves from its cache.
      // That load lands after the tap returns. Reconnecting while it was under
      // way replaced the page in the middle of the checks below (#864), so wait
      // for it here, still offline.
      await tap(page.getByRole("button", { name: "save and return to home" }));
      await page.waitForURL(`**${pathForTab(DEFAULT_TAB)}`);
      await expect(beginButton(page)).toBeVisible();
      await expect(offlineIndicator(page)).toBeVisible();
      await markSameDocument(page);

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
