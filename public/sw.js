/* Still Point service worker (#347 push, #431 suppression, #558 offline PWA). */

/*
 * Offline PWA (#558). Keep these in sync with src/lib/offlineSessionQueue/constants.ts.
 */
const OFFLINE_IDB_NAME = "stillpoint-offline-v1";
const OFFLINE_IDB_STORE = "session-queue";
const OFFLINE_SYNC_TAG = "stillpoint-session-sync";
const OFFLINE_QUEUE_LOCK_NAME = "stillpoint-session-queue";
/** #907: one upload's deadline; constants.ts explains its size. */
const UPLOAD_TIMEOUT_MS = 60 * 1000;
const APP_SHELL_CACHE = "stillpoint-app-shell-v1";
const APP_SHELL_URLS = ["/app/progress", "/app", "/og.png", "/manifest.webmanifest"];

/*
 * Offline in-app moves (#967). A `router.push` does not load a document: the
 * App Router fetches the destination's route data (an RSC payload, sent with an
 * `RSC: 1` header and a `?_rsc=` search param). Offline that fetch failed, and
 * Next.js fell back to a full page load, which restarted the app and dropped
 * everything held in memory.
 *
 * The worker now keeps one route-data payload per app route and answers a
 * failed fetch with it, so the move stays in the same document. The worker
 * fetches the payloads itself with only the `RSC: 1` header, which makes the
 * server render the whole tree from the root rather than a diff against one
 * page's router state, so a payload is valid whichever route the page moves
 * from. They are refreshed whenever an app document loads online.
 *
 * They are stored under an internal origin, so the document fallback's
 * `caches.match(request)` can never answer a page load with route data.
 *
 * Keep RSC_WARM_PATHS in sync with ALL_TABS in src/lib/appTabs.ts and with
 * the static pages under src/app/app/ (swRouteData.test.ts checks both).
 * Pages with a dynamic segment, such as /app/buddies/[id]/calendar, have no
 * fixed path to warm; an offline move to one still falls back to a document
 * load.
 */
const RSC_CACHE = "stillpoint-rsc-v1";
const RSC_KEY_ORIGIN = "https://still-point.internal/__rsc__";
const RSC_WARM_PATHS = [
  "/app",
  "/app/progress",
  "/app/history",
  "/app/journal",
  "/app/board",
  "/app/friends",
  "/app/settings",
  "/app/buddy",
  // Static pages linked from the tabs. log-reason reads its `date` on the
  // client, so the search-less payload also serves `/app/log-reason?date=…`.
  "/app/settings/notifications",
  "/app/buddies/calendar",
  "/app/log-reason",
];
/** A refresh of every payload runs at most this often. */
const RSC_WARM_INTERVAL_MS = 60 * 1000;
const RSC_CONTENT_TYPE = "text/x-component";

/*
 * Suppress-during-session (#431). The app page relays the desired suppression
 * state over a BroadcastChannel; while suppression is active we skip
 * showNotification so reminders do not interrupt a sit. The flag is also
 * persisted in Cache Storage so a push that spins up a fresh service worker
 * (in-memory state lost) still honors the most recent state.
 *
 * Keep SW_SUPPRESSION_CHANNEL / SUPPRESS_TTL_MS in sync with
 * SESSION_SUPPRESSION_CHANNEL / SUPPRESS_HEARTBEAT_MS in
 * src/lib/sessionSuppressionPrefs.ts.
 *
 * The persisted state carries an expiry so a missed "off" relay (e.g. the tab
 * was killed mid-sit) self-heals: a stale "suppress" lapses after the TTL
 * instead of silencing notifications forever. The page re-broadcasts on a
 * heartbeat (shorter than the TTL) so an in-progress sit stays covered.
 *
 * Tradeoff: the Push API mandates `userVisibleOnly`, so browsers may eventually
 * show a generic "site updated in background" notice or revoke the push budget
 * if many pushes are silently dropped. Suppression is opt-in and scoped to the
 * brief duration of an active sit, which keeps that risk low.
 */
const SW_SUPPRESSION_CHANNEL = "stillpoint-session-suppression";
const STATE_CACHE = "stillpoint-state-v1";
const SUPPRESSION_STATE_URL = "https://still-point.internal/__session_suppression__";
const OFFLINE_OWNER_STATE_URL = "https://still-point.internal/__offline_owner__";
/** A suppress flag older than this is treated as inactive (self-heals a missed reset). */
const SUPPRESS_TTL_MS = 10 * 60 * 1000;

/** In-memory mirror: { suppress: boolean, expiresAt: number } | null. */
let suppressState = null;

function isSuppressing(state, now) {
  return state?.suppress === true && typeof state.expiresAt === "number" && now < state.expiresAt;
}

async function persistSuppressState(state) {
  try {
    const cache = await caches.open(STATE_CACHE);
    await cache.put(
      SUPPRESSION_STATE_URL,
      new Response(JSON.stringify(state), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch {
    // Best-effort: fall back to in-memory state only.
  }
}

async function shouldSuppressDisplay() {
  const now = Date.now();
  if (suppressState) {
    return isSuppressing(suppressState, now);
  }
  try {
    const cache = await caches.open(STATE_CACHE);
    const cached = await cache.match(SUPPRESSION_STATE_URL);
    if (!cached) return false;
    suppressState = await cached.json();
    return isSuppressing(suppressState, Date.now());
  } catch {
    return false;
  }
}

try {
  const suppressionChannel = new BroadcastChannel(SW_SUPPRESSION_CHANNEL);
  suppressionChannel.onmessage = (event) => {
    if (event.data?.type !== "session-suppression-state") return;
    const suppress = event.data.suppress === true;
    suppressState = { suppress, expiresAt: suppress ? Date.now() + SUPPRESS_TTL_MS : 0 };
    // Fire-and-forget persistence; in-memory state is updated synchronously above.
    void persistSuppressState(suppressState);
  };
} catch {
  // BroadcastChannel unsupported: suppression simply never engages.
}

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OFFLINE_IDB_STORE)) {
        db.createObjectStore(OFFLINE_IDB_STORE, { keyPath: "clientSessionId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function loadOfflineEntries(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_IDB_STORE, "readonly");
    const store = tx.objectStore(OFFLINE_IDB_STORE);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
}

function saveOfflineEntries(db, entries) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_IDB_STORE, "readwrite");
    const store = tx.objectStore(OFFLINE_IDB_STORE);
    const clearRequest = store.clear();
    clearRequest.onerror = () => reject(clearRequest.error ?? new Error("IndexedDB clear failed"));
    clearRequest.onsuccess = () => {
      for (const entry of entries) {
        store.put(entry);
      }
    };
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
  });
}

/*
 * #907: each upload is aborted after UPLOAD_TIMEOUT_MS. The flush below holds
 * the queue lock across its uploads, so one that never settled would keep every
 * tab's queue writes waiting until the sync event ran out. A rejection ends the
 * flush, and what it had not sent stays queued for the next one.
 *
 * `readBody: false` resolves on the status alone, as the page's `batchThoughts`
 * does. The server has stored a thoughts batch once it answers 2xx, so a body
 * that stalls after that must not fail the upload and send the batch again.
 * The unread body is cancelled, so it does not hold its connection open.
 */
async function postJson(url, body, { readBody = true } = {}) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Request failed (${res.status})`);
    }
    if (!readBody) {
      void res.body?.cancel().catch(() => {});
      return null;
    }
    // Awaited inside the try, so the deadline still covers the body.
    return await res.json();
  } finally {
    clearTimeout(deadline);
  }
}

async function readOfflineOwnerUserId() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const cached = await cache.match(OFFLINE_OWNER_STATE_URL);
    if (!cached) return null;
    const data = await cached.json();
    return typeof data.userId === "string" ? data.userId : null;
  } catch {
    return null;
  }
}

async function flushOfflineQueueFromSw() {
  const ownerUserId = await readOfflineOwnerUserId();
  if (!ownerUserId) {
    await notifyClientsToFlush();
    return;
  }
  const db = await openOfflineDb();
  try {
    const entries = await loadOfflineEntries(db);
    let changed = false;
    try {
      for (const entry of entries) {
        if (entry.ownerUserId !== ownerUserId) continue;
        const hasThoughts = entry.thoughts?.length > 0;
        // #980: a cleared end note is queued as this flag, as the page's
        // `flushEntry` sends it, so an entry with only the flag still owes a batch.
        const sendClear = entry.clearCompletionNote === true;
        if (entry.sessionSynced && !hasThoughts && !sendClear) {
          continue;
        }
        if (!entry.sessionSynced) {
          const data = await postJson("/api/sessions", entry.request);
          entry.serverSessionId = data.session?.id ?? null;
          entry.sessionSynced = true;
          changed = true;
        }
        if (entry.serverSessionId && (hasThoughts || sendClear)) {
          await postJson(
            "/api/thoughts/batch",
            {
              sessionId: entry.serverSessionId,
              dayNumber: entry.request.dayNumber,
              // #948: sent as queued. Each in-session thought keeps the
              // `clientThoughtId` the page gave it, so a batch the server stored
              // before its upload timed out is stored once when sent again.
              thoughts: entry.thoughts ?? [],
              // #980: replaying a clear deletes the one stored note row again,
              // so a clear whose answer was lost is safe to send twice.
              ...(sendClear ? { clearCompletionNote: true } : {}),
            },
            { readBody: false },
          );
          // Reached only on a 2xx: a failed or timed-out upload rejects above
          // and leaves the thoughts and the flag queued for the next flush.
          entry.thoughts = [];
          if (sendClear) entry.clearCompletionNote = false;
          changed = true;
        }
      }
    } finally {
      // #907: saved when an upload fails or times out too, so the batches sent
      // before it are not sent again; the server would store their thoughts twice.
      if (changed) {
        await saveOfflineEntries(db, entries);
      }
    }
  } finally {
    db.close();
  }
}

/*
 * #834: every tab holds this Web Lock for each of its queue writes
 * (`withQueueMutation` in src/lib/offlineSessionQueue/sessionSyncCoordinator.ts).
 * The flush above rewrites the whole store from the one read it starts with, so
 * without the lock it could undo a tab's note edit, or drop a sit that a tab
 * queued while the uploads were running.
 */
function withOfflineQueueLock(fn) {
  const locks = self.navigator?.locks;
  if (!locks || typeof locks.request !== "function") return fn();
  return locks.request(OFFLINE_QUEUE_LOCK_NAME, () => fn());
}

async function notifyClientsToFlush() {
  const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of windowClients) {
    client.postMessage({ type: "flush-offline-session-queue" });
  }
}

function isStaticAssetRequest(request) {
  const url = new URL(request.url);
  return url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/audio/")
    || url.pathname === "/og.png"
    || url.pathname === "/manifest.webmanifest";
}

/** Route-data fetches the App Router makes for a client-side move or a prefetch. */
function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

/** Prefetches only fill the router's own cache, and Next.js drops a failed one
 *  quietly, so the worker leaves them to the network. */
function isRscPrefetchRequest(request) {
  return request.headers.has("Next-Router-Prefetch") || request.headers.has("Next-Router-Segment-Prefetch");
}

/** The cache key for a route's payload: its path and search, without `_rsc`. */
function rscCacheKey(pathname, searchParams) {
  const key = new URL(RSC_KEY_ORIGIN + pathname);
  for (const [name, value] of searchParams ?? []) {
    if (name !== "_rsc") key.searchParams.append(name, value);
  }
  return key.href;
}

/** A stored payload for `url`: the exact route first, then the same path with
 *  no search (`/app/progress?buddy=…` renders the same page as `/app/progress`).
 *  Rebuilt as a fresh Response, so the page reads the URL it asked for. */
async function matchRscPayload(url) {
  const cache = await caches.open(RSC_CACHE);
  const cached = (await cache.match(rscCacheKey(url.pathname, url.searchParams), { ignoreVary: true }))
    ?? (await cache.match(rscCacheKey(url.pathname), { ignoreVary: true }));
  if (!cached) return undefined;
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers: cached.headers });
}

function isStorableRscResponse(response) {
  return response.ok
    && !response.redirected
    && (response.headers.get("Content-Type") ?? "").startsWith(RSC_CONTENT_TYPE);
}

/** Fetches and stores one route's whole-tree payload. Best-effort: resolves
 *  true once the payload is stored, false otherwise. */
async function warmRscPath(cache, path) {
  try {
    // A bare `_rsc` is the cache-busting value Next.js expects with no router
    // headers, so a server that validates it answers rather than redirecting.
    const response = await fetch(`${path}?_rsc`, {
      headers: { RSC: "1" },
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!isStorableRscResponse(response)) return false;
    const headers = new Headers(response.headers);
    // Matched with ignoreVary anyway, and `Vary: *` would make the put throw.
    headers.delete("Vary");
    const body = await response.arrayBuffer();
    await cache.put(
      rscCacheKey(path),
      new Response(body, { status: response.status, statusText: response.statusText, headers }),
    );
    return true;
  } catch {
    // Offline or a failed render: the payload already stored stays.
    return false;
  }
}

let rscWarmInFlight = null;
let rscWarmedAt = 0;

/** Refreshes every app route's payload, at most once per RSC_WARM_INTERVAL_MS.
 *  The throttle holds only after a pass that stored every route, and only while
 *  every route is still stored: a partial pass, or a cache the page cleared on
 *  a sign-out (src/lib/swRouteDataCache.ts), is warmed again on the next load. */
function warmRscCache() {
  if (rscWarmInFlight) return rscWarmInFlight;
  rscWarmInFlight = caches
    .open(RSC_CACHE)
    .then(async (cache) => {
      if (rscWarmedAt && Date.now() - rscWarmedAt < RSC_WARM_INTERVAL_MS) {
        const stored = await Promise.all(
          RSC_WARM_PATHS.map((path) => cache.match(rscCacheKey(path), { ignoreVary: true })),
        );
        if (stored.every(Boolean)) return;
      }
      const results = await Promise.all(RSC_WARM_PATHS.map((path) => warmRscPath(cache, path)));
      rscWarmedAt = results.every(Boolean) ? Date.now() : 0;
    })
    .catch(() => {
      rscWarmedAt = 0;
    })
    .then(() => {
      rscWarmInFlight = null;
    });
  return rscWarmInFlight;
}

function isAppDocumentPath(pathname) {
  return pathname === "/app" || pathname.startsWith("/app/");
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) =>
            (key.startsWith("stillpoint-app-shell-") && key !== APP_SHELL_CACHE)
            || (key.startsWith("stillpoint-rsc-") && key !== RSC_CACHE))
          .map((key) => caches.delete(key)),
      ),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
            // #967: the app is reachable, so refresh its route data for the
            // in-app moves this document may make offline later.
            // Best-effort: a refresh that cannot run must not fail the page load.
            if (isAppDocumentPath(url.pathname)) {
              try {
                event.waitUntil(warmRscCache());
              } catch {
                void warmRscCache();
              }
            }
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const shell = await caches.match("/app/progress");
          if (shell) return shell;
          return caches.match("/app");
        }),
    );
    return;
  }

  // #967: an in-app move's route data. The network answers while it can; a
  // failed fetch gets the stored payload, so the move stays in this document.
  // With nothing stored the fetch still fails, and Next.js loads the page as a
  // document, which the branch above serves from the cache.
  if (isRscRequest(request, url)) {
    if (isRscPrefetchRequest(request)) return;
    event.respondWith(
      fetch(request).catch(async (error) => {
        const cached = await matchRscPayload(url).catch(() => undefined);
        if (cached) return cached;
        throw error;
      }),
    );
    return;
  }

  if (isStaticAssetRequest(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          void fetch(request)
            .then((response) => {
              if (response.ok) {
                const copy = response.clone();
                void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== OFFLINE_SYNC_TAG) return;
  event.waitUntil(
    // #907: a failed flush, such as an upload that timed out, still fails the
    // event once the tabs are told. The browser then retries the sync later, so
    // a queued sit is retried even when no tab is open to flush it. Telling the
    // tabs is best-effort: it never fails a sync that sent everything, and never
    // replaces the flush's own error.
    withOfflineQueueLock(() => flushOfflineQueueFromSw()).then(
      () => notifyClientsToFlush().catch(() => {}),
      async (error) => {
        await notifyClientsToFlush().catch(() => {});
        throw error;
      },
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = typeof data.title === "string" ? data.title : "Still Point";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" ? data.url : "/app";

  event.waitUntil(
    shouldSuppressDisplay().then((suppress) => {
      if (suppress) {
        // In-session + opt-in: drop the notification display (#431).
        return undefined;
      }
      return self.registration.showNotification(title, {
        body,
        icon: "/og.png",
        badge: "/og.png",
        data: { url },
        tag: typeof data.type === "string" ? data.type : "still-point",
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const rawTarget = typeof event.notification.data?.url === "string"
    ? event.notification.data.url
    : "/app";
  const parsedTarget = new URL(rawTarget, self.location.origin);
  const targetUrl = parsedTarget.origin === self.location.origin
    ? parsedTarget.href
    : new URL("/app", self.location.origin).href;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          return client.focus().then((focused) => {
            if (focused && "navigate" in focused) {
              return focused.navigate(targetUrl);
            }
            return undefined;
          });
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
      return undefined;
    }),
  );
});
