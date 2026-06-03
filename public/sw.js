/* Still Point Web Push service worker (#347). Served from site root. */

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
    self.registration.showNotification(title, {
      body,
      icon: "/og.png",
      badge: "/og.png",
      data: { url },
      tag: typeof data.type === "string" ? data.type : "still-point",
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
