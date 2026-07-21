/* Still Point service worker (#347 push, #431 suppression, #558 offline PWA). */

/*
 * Offline PWA (#558). Keep these in sync with src/lib/offlineSessionQueue/constants.ts.
 */
const OFFLINE_IDB_NAME = "stillpoint-offline-v1";
const OFFLINE_IDB_STORE = "session-queue";
const OFFLINE_SYNC_TAG = "stillpoint-session-sync";
const APP_SHELL_CACHE = "stillpoint-app-shell-v1";
const APP_SHELL_URLS = ["/app/progress", "/app", "/og.png", "/manifest.webmanifest"];

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

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed (${res.status})`);
  }
  return res.json();
}

async function flushOfflineQueueFromSw() {
  const db = await openOfflineDb();
  try {
    const entries = await loadOfflineEntries(db);
    let changed = false;
    for (const entry of entries) {
      if (entry.sessionSynced && (!entry.thoughts || entry.thoughts.length === 0)) {
        continue;
      }
      if (!entry.sessionSynced) {
        const data = await postJson("/api/sessions", entry.request);
        entry.serverSessionId = data.session?.id ?? null;
        entry.sessionSynced = true;
        changed = true;
      }
      if (entry.serverSessionId && entry.thoughts?.length > 0) {
        await postJson("/api/thoughts/batch", {
          sessionId: entry.serverSessionId,
          dayNumber: entry.request.dayNumber,
          thoughts: entry.thoughts,
        });
        entry.thoughts = [];
        changed = true;
      }
    }
    if (changed) {
      await saveOfflineEntries(db, entries);
    }
  } finally {
    db.close();
  }
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
          .filter((key) => key.startsWith("stillpoint-app-shell-") && key !== APP_SHELL_CACHE)
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

  if (isStaticAssetRequest(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const networkFetch = fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(APP_SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
        return cached ?? networkFetch;
      }),
    );
  }
});

self.addEventListener("sync", (event) => {
  if (event.tag !== OFFLINE_SYNC_TAG) return;
  event.waitUntil(
    flushOfflineQueueFromSw()
      .then(() => notifyClientsToFlush())
      .catch(() => notifyClientsToFlush()),
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
