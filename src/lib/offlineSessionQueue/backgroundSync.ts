import { OFFLINE_SYNC_TAG } from "./constants";

export async function requestBackgroundSync(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return;
  }
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2_000)),
    ]);
    if (!registration || !("sync" in registration)) {
      return;
    }
    await (registration as ServiceWorkerRegistration & {
      sync: { register: (tag: string) => Promise<void> };
    }).sync.register(OFFLINE_SYNC_TAG);
  } catch {
    // Background Sync is best-effort; foreground online flush covers unsupported browsers.
  }
}
