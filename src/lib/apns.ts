import "server-only";
import crypto from "node:crypto";
import http2 from "node:http2";
import { SignJWT, importPKCS8 } from "jose";

const APNS_DEVELOPMENT_HOST = "https://api.sandbox.push.apple.com";
const APNS_PRODUCTION_HOST = "https://api.push.apple.com";
const JWT_TTL_MS = 45 * 60 * 1000;
const APNS_REQUEST_TIMEOUT_MS = 10_000;

export type ApnsEnvironment = "development" | "production";

export type ApnsPayload = {
  aps: {
    alert: {
      title: string;
      body: string;
    };
    sound?: string;
    badge?: number;
    "thread-id"?: string;
  };
  [key: string]: unknown;
};

export type ApnsSendResult =
  | { ok: true; status: number; apnsId?: string }
  | { ok: false; status: number; reason?: string; apnsId?: string };

type ApnsConfig = {
  bundleId: string;
  teamId: string;
  keyId: string;
  privateKey: string;
};

let cachedJwt: { token: string; expiresAt: number } | null = null;

/** Environment variables required to authenticate with APNs (see docs/notifications.md).
 *  Every environment that dispatches iOS push must set all four. */
export const REQUIRED_APNS_ENV_VARS = [
  "APNS_BUNDLE_ID",
  "APNS_TEAM_ID",
  "APNS_KEY_ID",
  "APNS_PRIVATE_KEY",
] as const;

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

/**
 * Non-throwing check of the APNs provider configuration. Lets callers surface a
 * misconfigured environment with a single actionable signal, instead of letting
 * getApnsConfig() throw once per device token deep inside the send loop where a
 * per-token catch swallows it — the failure mode that left every scheduled push
 * silently undelivered behind a cron 200 (#621).
 */
export function getApnsConfigStatus(): { configured: boolean; missing: string[] } {
  const missing = REQUIRED_APNS_ENV_VARS.filter((name) => {
    const value = process.env[name];
    return value === undefined || value === "";
  });
  return { configured: missing.length === 0, missing };
}

function getApnsConfig(): ApnsConfig {
  return {
    bundleId: getRequiredEnv("APNS_BUNDLE_ID"),
    teamId: getRequiredEnv("APNS_TEAM_ID"),
    keyId: getRequiredEnv("APNS_KEY_ID"),
    privateKey: getRequiredEnv("APNS_PRIVATE_KEY").replace(/\\n/g, "\n"),
  };
}

function getApnsHost(environment: ApnsEnvironment): string {
  return environment === "production" ? APNS_PRODUCTION_HOST : APNS_DEVELOPMENT_HOST;
}

async function getProviderToken(config: ApnsConfig): Promise<string> {
  const now = Date.now();
  if (cachedJwt && cachedJwt.expiresAt > now) {
    return cachedJwt.token;
  }

  const key = await importPKCS8(config.privateKey, "ES256");
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(Math.floor(now / 1000))
    .sign(key);

  cachedJwt = { token, expiresAt: now + JWT_TTL_MS };
  return token;
}

function requestBody(payload: ApnsPayload): Buffer {
  return Buffer.from(JSON.stringify(payload));
}

export async function sendApnsNotification(
  deviceToken: string,
  environment: ApnsEnvironment,
  payload: ApnsPayload,
): Promise<ApnsSendResult> {
  const config = getApnsConfig();
  const providerToken = await getProviderToken(config);
  const host = getApnsHost(environment);
  const body = requestBody(payload);

  return new Promise((resolve, reject) => {
    const client = http2.connect(host);
    const path = `/3/device/${deviceToken}`;
    let responseBody = "";
    let status = 0;
    let apnsId: string | undefined;
    let settled = false;

    const finish = (result?: ApnsSendResult, error?: Error) => {
      if (settled) return;
      settled = true;
      client.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve(result!);
    };

    client.once("error", (error) => finish(undefined, error));

    const request = client.request({
      ":method": "POST",
      ":path": path,
      authorization: `bearer ${providerToken}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
      "content-length": String(body.length),
    });

    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[":status"] ?? 0);
      const headerApnsId = headers["apns-id"];
      apnsId = Array.isArray(headerApnsId) ? headerApnsId[0] : headerApnsId;
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.setTimeout(APNS_REQUEST_TIMEOUT_MS, () => {
      request.close(http2.constants.NGHTTP2_CANCEL);
      finish({ ok: false, status: 0, reason: "APNs request timeout" });
    });
    request.once("error", (error) => finish(undefined, error));
    request.on("end", () => {
      if (status >= 200 && status < 300) {
        finish({ ok: true, status, apnsId });
        return;
      }

      let reason: string | undefined;
      try {
        const parsed = JSON.parse(responseBody) as { reason?: unknown };
        reason = typeof parsed.reason === "string" ? parsed.reason : undefined;
      } catch {
        reason = responseBody || undefined;
      }

      finish({ ok: false, status, reason, apnsId });
    });
    request.end(body);
  });
}

function normalizeDeviceToken(token: string): string {
  return token.trim().toLowerCase();
}

export function hashDeviceToken(token: string): string {
  return crypto.createHash("sha256").update(normalizeDeviceToken(token)).digest("hex");
}

export function isValidDeviceToken(token: string): boolean {
  return /^[0-9a-f]{64,200}$/.test(normalizeDeviceToken(token));
}

/** Clears the in-memory provider JWT cache (test isolation). */
export function resetApnsProviderTokenCacheForTests(): void {
  cachedJwt = null;
}
