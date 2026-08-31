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

async function postSessionActiveState(active: boolean): Promise<void> {
  try {
    await fetch("/api/notifications/session-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
      keepalive: true,
      signal: AbortSignal.timeout(SESSION_STATE_TIMEOUT_MS),
    });
  } catch {
    // Ignore: the server signal self-heals via its TTL.
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

function drainSessionStateQueue(epoch: number): Promise<void> {
  if (epoch !== queueEpoch) return Promise.resolve();
  const next = queuedActive;
  queuedActive = null;
  if (next === null) {
    inFlight = null;
    return Promise.resolve();
  }
  inFlight = postSessionActiveState(next).then(() => drainSessionStateQueue(epoch));
  return inFlight;
}

/**
 * Drops any pending session-state report at an auth boundary (#709).
 *
 * The queue is module-global and web sign-out is an in-page state reset rather
 * than a reload, so a report queued under one account would otherwise drain under
 * the next account's cookie and suppress *their* notifications for a full TTL.
 * A request already dispatched keeps the cookie it was sent with, so only the
 * queued state has to go. Mirrors the offline session queue, which is cleared on
 * logout for the same reason, and the iOS
 * `SessionNotificationSuppressionController.clearSuppressPreference`.
 */
export function resetSessionStateReports(): void {
  queueEpoch += 1;
  queuedActive = null;
  inFlight = null;
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
  inFlight = postSessionActiveState(active).then(() => drainSessionStateQueue(epoch));
  return inFlight;
}

export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
