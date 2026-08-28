import type { User } from "@/lib/api";
import { mayClearAccountScopedState, type SignedOutCause } from "@/lib/offlineAuth";

/**
 * #666 — the last authenticated `User`, kept in the browser so a cold reload of
 * the installed PWA with no network still knows who you are, what day you're on
 * and which tracks you run. The web mirror of the iOS `CachedIdentityStore`
 * (#665).
 *
 * **Where it lives.** `localStorage`, following the existing preference-cache
 * convention (`displayPrefs.ts`, `trackingControlPrefs.ts`) rather than the
 * IndexedDB the offline session queue uses. The queue is in IndexedDB because
 * the *service worker* has to read it during a background sync; this payload is
 * small, is read exactly once per bootstrap by the page, and is needed
 * synchronously before the first render — three reasons the queue's storage
 * choice does not carry over. No session token is stored here: the session
 * cookie stays where the browser keeps it, and only the non-secret identity
 * payload (id, username, day counters, feature flags) lands in this key.
 *
 * **Staleness is accepted, deliberately.** A cached identity older than the
 * server's session means the user sits happily offline and then hits a 401 on
 * reconnect, at which point `clearCachedUserIfAuthoritative` wipes it and they
 * sign in again. That is strictly better than the alternative it replaces —
 * being logged out at the moment of *losing* the network rather than the moment
 * of regaining it.
 */

/** Versioned like the iOS App Group key, so a future shape change can be
 *  introduced without misreading an old payload. */
const STORAGE_KEY = "stillpoint_cached_user_v1";

/**
 * Accept only a payload that can actually render the app. Every non-optional
 * `User` field must be present and correctly typed; anything else (a truncated
 * write, a payload from a future shape, hand-edited storage) is treated as no
 * cache at all rather than rendering a half-built account.
 */
function isCachedUser(value: unknown): value is User {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string"
    && typeof candidate.email === "string"
    && typeof candidate.username === "string"
    && typeof candidate.isPublic === "boolean"
    && typeof candidate.currentDay === "number"
    && typeof candidate.aphorismsEnabled === "boolean"
  );
}

export function loadCachedUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCachedUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the authenticated user. Called on every adopted user so the local
 * copy tracks the server (day number, recovery ramp, track opt-ins).
 */
export function saveCachedUser(user: User): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
  } catch {
    // Best-effort persistence: a full or blocked quota must not break the app.
  }
}

export function clearCachedUser(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort: a failed removal leaves a stale copy that the next
    // authoritative 401 will clear again.
  }
}

/**
 * Clear the cached identity only for a cause authoritative enough to prove the
 * session is over — the same predicate that guards the widget's stored week
 * (#676) and the iOS cached identity (#665).
 *
 * Returns whether it actually cleared, so callers can gate the rest of their
 * sign-out teardown on the same single answer.
 */
export function clearCachedUserIfAuthoritative(cause: SignedOutCause): boolean {
  if (!mayClearAccountScopedState(cause)) return false;
  clearCachedUser();
  return true;
}
