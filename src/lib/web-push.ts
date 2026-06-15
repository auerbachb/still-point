import crypto from "node:crypto";
import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { webPushSubscriptions } from "@/db/schema";

const PUSH_SEND_CONCURRENCY = 3;

export type WebPushPayload = {
  title: string;
  body: string;
  type: string;
  /** Path opened when the user clicks the notification (default /app). */
  url?: string;
};

export type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

let vapidConfigured = false;

export function hashWebPushEndpoint(endpoint: string): string {
  return crypto.createHash("sha256").update(endpoint.trim()).digest("hex");
}

export function isValidPushSubscriptionInput(value: unknown): value is PushSubscriptionInput {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.endpoint !== "string") {
    return false;
  }
  // Require a public HTTPS URL to prevent SSRF via web-push fan-out
  try {
    const url = new URL(record.endpoint);
    if (url.protocol !== "https:") return false;
    const h = url.hostname;
    if (
      // IPv4 private / loopback / link-local
      h === "localhost" ||
      /^127\./.test(h) ||
      h === "0.0.0.0" ||
      h === "169.254.169.254" ||
      h === "metadata.google.internal" ||
      /^10\./.test(h) ||
      /^192\.168\./.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h.endsWith(".local") ||
      h.endsWith(".internal") ||
      h.endsWith(".localhost") ||
      // IPv6 loopback, link-local (fe80::/10), ULA (fc00::/7), IPv4-mapped
      h === "::1" ||
      /^fe[89ab][0-9a-f]/i.test(h) ||
      /^f[cd][0-9a-f]{2}:/i.test(h) ||
      /^::ffff:/i.test(h)
    ) {
      return false;
    }
  } catch {
    return false;
  }
  if (!record.keys || typeof record.keys !== "object") {
    return false;
  }
  const keys = record.keys as Record<string, unknown>;
  return typeof keys.p256dh === "string" && keys.p256dh.length > 0
    && typeof keys.auth === "string" && keys.auth.length > 0;
}

export function getWebPushPublicKey(): string | null {
  const key = (process.env.WEB_PUSH_VAPID_PUBLIC_KEY ?? process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY ?? "").trim();
  return key.length > 0 ? key : null;
}

function getWebPushVapidSubject(): string | null {
  const subject = (process.env.WEB_PUSH_VAPID_SUBJECT ?? "").trim();
  return subject.length > 0 ? subject : null;
}

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) {
    return true;
  }
  const publicKey = getWebPushPublicKey();
  const privateKey = (process.env.WEB_PUSH_VAPID_PRIVATE_KEY ?? "").trim();
  const subject = getWebPushVapidSubject();
  if (!publicKey || !privateKey || !subject) {
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

function isExpiredSubscriptionError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const statusCode = (error as { statusCode?: number }).statusCode;
  return statusCode === 404 || statusCode === 410;
}

export async function sendWebPushToUser(params: {
  recipientUserId: string;
  payload: WebPushPayload;
}): Promise<{ delivered: boolean }> {
  if (!ensureVapidConfigured()) {
    return { delivered: false };
  }

  const subscriptions = await db
    .select({
      id: webPushSubscriptions.id,
      endpoint: webPushSubscriptions.endpoint,
      p256dh: webPushSubscriptions.p256dh,
      auth: webPushSubscriptions.auth,
    })
    .from(webPushSubscriptions)
    .where(and(
      eq(webPushSubscriptions.userId, params.recipientUserId),
      eq(webPushSubscriptions.enabled, true),
    ));

  if (subscriptions.length === 0) {
    return { delivered: false };
  }

  let delivered = false;

  const body = JSON.stringify({
    title: params.payload.title,
    body: params.payload.body,
    type: params.payload.type,
    url: params.payload.url ?? "/app",
  });

  for (let i = 0; i < subscriptions.length; i += PUSH_SEND_CONCURRENCY) {
    const batch = subscriptions.slice(i, i + PUSH_SEND_CONCURRENCY);
    await Promise.all(batch.map(async (row) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: row.endpoint,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          body,
        );
        const now = new Date();
        await db
          .update(webPushSubscriptions)
          .set({ lastUsedAt: now, updatedAt: now })
          .where(eq(webPushSubscriptions.id, row.id));
        delivered = true;
      } catch (error) {
        if (isExpiredSubscriptionError(error)) {
          await db
            .update(webPushSubscriptions)
            .set({ enabled: false, updatedAt: new Date() })
            .where(eq(webPushSubscriptions.id, row.id));
          return;
        }
        const status = typeof error === "object" && error !== null && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
        const message = error instanceof Error ? error.message : "unknown error";
        console.warn("Web Push notification failed", { subscriptionId: row.id, status, message });
      }
    }));
  }

  return { delivered };
}
