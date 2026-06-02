"use client";

export type NotificationPreferencesDto = {
  pushEnabled: boolean;
  dailyReminderEnabled: boolean;
  missADayEnabled: boolean;
  friendRequestNotificationsEnabled: boolean;
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
  const isIos = /iphone|ipad|ipod/i.test(ua);
  if (!isIos) {
    return false;
  }
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone !== true;
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
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
  const registration = await registerServiceWorker();
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
  const registration = await navigator.serviceWorker.ready;
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
  await fetch("/api/notifications/push/subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
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

export function detectedTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
