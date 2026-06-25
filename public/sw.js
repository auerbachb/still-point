/* Still Point Web Push service worker (#347). Served from site root. */

/*
 * Suppress-during-session (#431). The app page relays the desired suppression
 * state over a BroadcastChannel; while suppression is active we skip
 * showNotification so reminders do not interrupt a sit. The flag is also
 * persisted in Cache Storage so a push that spins up a fresh service worker
 * (in-memory state lost) still honors the most recent state.
 *
 * Keep SW_SUPPRESSION_CHANNEL in sync with SESSION_SUPPRESSION_CHANNEL in
 * src/lib/sessionSuppressionPrefs.ts.
 *
 * Tradeoff: the Push API mandates `userVisibleOnly`, so browsers may eventually
 * show a generic "site updated in background" notice or revoke the push budget
 * if many pushes are silently dropped. Suppression is opt-in and scoped to the
 * brief duration of an active sit, which keeps that risk low.
 */
const SW_SUPPRESSION_CHANNEL = "stillpoint-session-suppression";
const STATE_CACHE = "stillpoint-state-v1";
const SUPPRESSION_STATE_URL = "https://still-point.internal/__session_suppression__";

let suppressDisplay = false;

async function persistSuppressDisplay(value) {
  try {
    const cache = await caches.open(STATE_CACHE);
    await cache.put(
      SUPPRESSION_STATE_URL,
      new Response(JSON.stringify({ suppress: value }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch {
    // Best-effort: fall back to in-memory state only.
  }
}

async function readSuppressDisplay() {
  try {
    const cache = await caches.open(STATE_CACHE);
    const cached = await cache.match(SUPPRESSION_STATE_URL);
    if (!cached) return suppressDisplay;
    const data = await cached.json();
    suppressDisplay = data?.suppress === true;
    return suppressDisplay;
  } catch {
    return suppressDisplay;
  }
}

try {
  const suppressionChannel = new BroadcastChannel(SW_SUPPRESSION_CHANNEL);
  suppressionChannel.onmessage = (event) => {
    if (event.data?.type !== "session-suppression-state") return;
    suppressDisplay = event.data.suppress === true;
    // Fire-and-forget persistence; in-memory state is updated synchronously above.
    void persistSuppressDisplay(suppressDisplay);
  };
} catch {
  // BroadcastChannel unsupported: suppression simply never engages.
}

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
    readSuppressDisplay().then((suppress) => {
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
