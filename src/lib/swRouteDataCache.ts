/**
 * #967 — the service worker keeps one route-data (RSC) payload per app route so
 * an offline in-app move stays in the same document. Those payloads are
 * rendered for whoever was signed in, so they are account-scoped state: left in
 * place after a sign-out, an authoritative 401/403/404 or another account
 * replacing this one, an offline move in the next account's session could be
 * answered with the previous account's history, journal or progress.
 *
 * Cache Storage is shared between the page and its worker, so the page drops
 * the whole cache itself, in every version the worker may have written. The
 * worker re-fills it on the next online document load.
 *
 * Keep the prefix in sync with RSC_CACHE in public/sw.js.
 */
export const SW_ROUTE_DATA_CACHE_PREFIX = "stillpoint-rsc-";

/** Deletes every route-data cache. Best-effort: never throws. */
export async function clearSwRouteDataCache(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith(SW_ROUTE_DATA_CACHE_PREFIX)).map((key) => caches.delete(key)),
    );
  } catch (error) {
    console.error("Failed to clear the offline route-data cache:", error);
  }
}
