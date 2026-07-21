"use client";

import { getWebSessionSyncCoordinator } from "./sessionSyncCoordinator";

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

let bootstrapStarted = false;

export async function persistOfflineOwnerUserId(userId: string | null): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const cache = await caches.open("stillpoint-state-v1");
    await cache.put(
      "https://still-point.internal/__offline_owner__",
      new Response(JSON.stringify({ userId }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  } catch {
    // Best-effort: foreground flush still has owner context.
  }
}

/** Register the PWA service worker and wire reconnect flush (#558). */
export function initWebPwaOffline(ownerUserIdProvider: () => string | null): () => void {
  if (typeof window === "undefined" || bootstrapStarted) {
    return () => {};
  }
  bootstrapStarted = true;

  void registerServiceWorker().catch(() => {});

  const coordinator = getWebSessionSyncCoordinator();

  const flushForCurrentUser = () => {
    const ownerUserId = ownerUserIdProvider();
    if (!ownerUserId) return;
    void coordinator.flushPending(ownerUserId).catch(() => {});
  };

  const onOnline = () => flushForCurrentUser();
  window.addEventListener("online", onOnline);

  const onVisibility = () => {
    if (document.visibilityState === "visible") {
      flushForCurrentUser();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const onMessage = (event: MessageEvent) => {
    if (event.data?.type === "flush-offline-session-queue") {
      flushForCurrentUser();
    }
  };
  navigator.serviceWorker?.addEventListener("message", onMessage);

  flushForCurrentUser();

  return () => {
    bootstrapStarted = false;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    navigator.serviceWorker?.removeEventListener("message", onMessage);
  };
}
