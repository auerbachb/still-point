"use client";

import { registerServiceWorker } from "@/lib/offlineSessionQueue/pwaBootstrap";

export type NotificationPreferencesDto = {
  pushEnabled: boolean;
  dailyReminderEnabled: boolean;
  missADayEnabled: boolean;
  failureReasonReminderEnabled: boolean;
  friendRequestNotificationsEnabled: boolean;
  suppressDuringSession: boolean;
  dailyReminderTime: string;
  dailyReminderFrequency: "daily" | "every_other" | "weekly";
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  tz: string;
};

export function isWebPushSupported(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window;
}

/** iOS Safari only delivers web push to home-screen PWAs (iOS 16.4+). */
export function needsPwaInstallForWebPush(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const ua = navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!isIos) {
    return false;
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone !== true;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function fetchVapidPublicKey(): Promise<string> {
  const res = await fetch("/api/notifications/push/subscription");
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.publicKey !== "string") {
    throw new Error(data.error ?? "Web Push is not available");
  }
  return data.publicKey;
}

export async function subscribeBrowserPush(publicKey: string): Promise<PushSubscription> {
  await registerServiceWorker();
  // Wait for the service worker to become active before subscribing; on first
  // install the registration returned by register() may still be in the
  // "installing" state and pushManager.subscribe() would fail intermittently.
  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return existing;
  }
  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
}

export async function unsubscribeBrowserPush(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration) {
    return null;
  }
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return null;
  }
  await subscription.unsubscribe();
  return subscription;
}

export async function registerWebPushSubscription(subscription: PushSubscription): Promise<void> {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error("Invalid push subscription");
  }
  const res = await fetch("/api/notifications/push/subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscription: {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      },
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? "Could not save push subscription");
  }
}

export async function unregisterWebPushEndpoint(endpoint: string): Promise<void> {
  const res = await fetch("/api/notifications/push/subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Could not unregister push subscription (${res.status})`);
  }
}

export async function patchNotificationPreferences(
  patch: Partial<NotificationPreferencesDto>,
): Promise<NotificationPreferencesDto> {
  const res = await fetch("/api/notifications/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? "Could not update notification preferences");
  }
  return data.preferences as NotificationPreferencesDto;
}

export async function fetchNotificationPreferences(): Promise<NotificationPreferencesDto> {
  const res = await fetch("/api/notifications/preferences");
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error ?? "Could not load notification preferences");
  }
  return data.preferences as NotificationPreferencesDto;
}

/**
 * A hung request must not stall the queue below — the state it is blocking may be
 * the `false` that ends a sit, and until that lands the server keeps withholding.
 */
const SESSION_STATE_TIMEOUT_MS = 10_000;

/**
 * `fetch` resolves rather than rejects on a 4xx/5xx, so a rejected report is
 * otherwise indistinguishable from a delivered one. That matters asymmetrically:
 * the heartbeat re-asserts `active: true` every 60s, but nothing re-asserts the
 * `false` that ends a sit, so silently dropping that one leaves the user muted
 * until the server-side TTL expires — the exact failure this endpoint exists to
 * prevent. Clearing therefore gets one extra attempt; the TTL stays the backstop,
 * and a loop would be worse than useless on an unmount report.
 */
async function postSessionActiveState(active: boolean, epoch: number): Promise<void> {
  const attempts = active ? 1 : 2;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // An auth boundary crossed while the previous attempt was in flight. The
    // report belongs to a session that is over; retrying it would re-introduce
    // exactly the late write the abort below exists to prevent.
    if (epoch !== queueEpoch) return;

    // The deadline is driven manually rather than with `AbortSignal.timeout` so
    // the same controller can also be tripped by `resetSessionStateReports`,
    // without needing `AbortSignal.any` (still missing on older mobile Safari,
    // and this is a PWA).
    const controller = new AbortController();
    activeController = controller;
    const deadline = setTimeout(() => controller.abort(), SESSION_STATE_TIMEOUT_MS);
    try {
      const res = await fetch("/api/notifications/session-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active }),
        keepalive: true,
        signal: controller.signal,
      });
      if (res.ok) return;
      // The session is gone — a retry cannot fix it, and the server expires the
      // hold on its own.
      if (res.status === 401) return;
      console.warn("session-state report rejected", { active, status: res.status, attempt });
    } catch {
      // Network error, deadline, or an auth-boundary abort. Retried once when
      // clearing (the epoch check above stops the retry after an abort), then
      // left to the TTL.
    } finally {
      clearTimeout(deadline);
      if (activeController === controller) activeController = null;
    }
  }
}

// One request in flight at a time, plus at most one queued state — the endpoint
// stores absolute state, so when reports pile up behind a slow request only the
// newest one still matters. Serializing also stops an in-flight heartbeat `true`
// from landing after the `false` that ended the sit and re-suppressing
// notifications for a full TTL.
let inFlight: Promise<void> | null = null;
let queuedActive: boolean | null = null;
// Bumped at every auth boundary so a chain started by the previous account cannot
// keep draining — or clobber the next account's `inFlight` — after the reset below.
let queueEpoch = 0;
// The request currently on the wire, so an auth boundary can cancel it outright
// rather than merely forgetting about it.
let activeController: AbortController | null = null;

function drainSessionStateQueue(epoch: number): Promise<void> {
  if (epoch !== queueEpoch) return Promise.resolve();
  const next = queuedActive;
  queuedActive = null;
  if (next === null) {
    inFlight = null;
    return Promise.resolve();
  }
  inFlight = postSessionActiveState(next, epoch).then(() => drainSessionStateQueue(epoch));
  return inFlight;
}

/**
 * Drops any pending session-state report at an auth boundary (#709).
 *
 * The queue is module-global and web sign-out is an in-page state reset rather
 * than a reload, so a report queued under one account would otherwise drain under
 * the next account's cookie and suppress *their* notifications for a full TTL.
 * Dropping the queued state is not enough on its own. A request already on the
 * wire keeps its own cookie, so it cannot land on the *next* account — but when
 * the same account signs back in it still can, and out of order: a stale `true`
 * settling after the `false` that ended a sit leaves the user muted for a full
 * TTL, and a stale `false` settling after the `true` that started a new one
 * clears the hold and puts banners in the middle of it. Serializing cannot help
 * across the boundary, because the reset deliberately forgets `inFlight`. So the
 * live request is aborted rather than abandoned.
 *
 * Mirrors the offline session queue, which is cleared on logout for the same
 * reason, and the iOS
 * `SessionNotificationSuppressionController.clearSuppressPreference`.
 */
export function resetSessionStateReports(): void {
  queueEpoch += 1;
  queuedActive = null;
  inFlight = null;
  activeController?.abort();
  activeController = null;
}

/**
 * Tells the server whether a sit is running so it withholds Still Point's own
 * pushes for the duration (#709). Best-effort: a failure leaves the client-side
 * service-worker suppression as the remaining layer, so it must never surface an
 * error into a live session view.
 *
 * @returns a promise that settles once this report — or a newer one that
 *   superseded it — has been sent.
 */
export function reportSessionActiveState(active: boolean): Promise<void> {
  if (inFlight) {
    // Newest state wins; superseded states are dropped rather than queued.
    queuedActive = active;
    return inFlight;
  }
  // `postSessionActiveState` swallows its own errors, so the chain never rejects
  // and one failed report cannot stall the ones behind it.
  const epoch = queueEpoch;
  inFlight = postSessionActiveState(active, epoch).then(() => drainSessionStateQueue(epoch));
  return inFlight;
}

export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
