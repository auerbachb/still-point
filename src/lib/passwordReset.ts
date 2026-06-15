import "server-only";

import { createHash, randomBytes } from "crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextRequest } from "next/server";

const TOKEN_BYTES = 32;
export const PASSWORD_RESET_TTL_MINUTES = 60;
const RESET_JWT_ISSUER = "still-point";
const RESET_JWT_AUDIENCE = "password-reset";
export const PASSWORD_RESET_REQUEST_MESSAGE =
  "If an account exists for that email, a reset link will arrive shortly.";

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET not set");
  return new TextEncoder().encode(secret);
}

export function passwordResetExpiresAt(now = new Date()) {
  return new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashResetRequestIp(ip: string | null) {
  if (!ip) return null;
  return createHash("sha256").update(ip).digest("hex");
}

export function normalizeResetEmail(email: unknown) {
  if (typeof email !== "string") return "";
  const normalized = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : "";
}

export function requestIpHash(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwardedFor || request.headers.get("x-real-ip");
  return hashResetRequestIp(ip);
}

export async function createPasswordResetToken({
  userId,
}: {
  userId: string;
}) {
  const nonce = randomBytes(TOKEN_BYTES).toString("base64url");
  return new SignJWT({ nonce })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(RESET_JWT_ISSUER)
    .setAudience(RESET_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(passwordResetExpiresAt().getTime() / 1000))
    .sign(getSecret());
}

export async function getPasswordResetPayload(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: RESET_JWT_ISSUER,
      audience: RESET_JWT_AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.nonce !== "string") {
      return null;
    }
    return { userId: payload.sub, tokenHash: hashResetToken(token) };
  } catch {
    return null;
  }
}

type ResetAttempt = {
  count: number;
  resetAt: number;
};

/**
 * Lightweight per-process throttle for reset requests. This is intentionally
 * paired with README guidance to keep platform/WAF throttling enabled in
 * production, since serverless instances do not share globalThis state.
 */
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_MAX_KEYS = 1_000;
const globalForPasswordReset = globalThis as typeof globalThis & {
  __passwordResetAttempts?: Map<string, ResetAttempt>;
};

function attemptsStore() {
  if (!globalForPasswordReset.__passwordResetAttempts) {
    globalForPasswordReset.__passwordResetAttempts = new Map();
  }
  return globalForPasswordReset.__passwordResetAttempts;
}

function rateLimitKey(email: string, ipHash: string | null) {
  return `${email}:${ipHash ?? "unknown"}`;
}

function pruneExpiredAttempts(now: number, store = attemptsStore()) {
  for (const [key, attempt] of store) {
    if (attempt.resetAt <= now) {
      store.delete(key);
    }
  }
}

export function isPasswordResetRateLimited(email: string, ipHash: string | null) {
  const now = Date.now();
  const store = attemptsStore();
  pruneExpiredAttempts(now, store);
  const attempt = store.get(rateLimitKey(email, ipHash));
  return Boolean(attempt && attempt.resetAt > now && attempt.count >= RATE_LIMIT_MAX_ATTEMPTS);
}

export function recordPasswordResetAttempt(email: string, ipHash: string | null) {
  const now = Date.now();
  const store = attemptsStore();
  pruneExpiredAttempts(now, store);
  if (store.size >= RATE_LIMIT_MAX_KEYS) {
    const oldestKey = store.keys().next().value as string | undefined;
    if (oldestKey) {
      store.delete(oldestKey);
    }
  }
  const key = rateLimitKey(email, ipHash);
  const attempt = store.get(key);
  if (!attempt || attempt.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return;
  }
  attempt.count += 1;
}
