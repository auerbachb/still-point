/**
 * #666 — offline-first identity on the web: what a failed `GET /api/auth/me`
 * means for routing and for the local state the app already holds.
 *
 * The TypeScript mirror of the iOS `OfflineAuth` landed in #665 (PR #696), and
 * deliberately the *same* three moving parts rather than a second convention:
 *
 *   1. one classifier that maps a failed `me()` onto a sign-out taxonomy,
 *   2. one shared predicate (`mayClearAccountScopedState`) deciding whether a
 *      cause is authoritative enough to destroy local state — used by every
 *      consumer (routing, the cached identity, the tracking-unlock reset),
 *   3. one outcome that keeps the user signed in from a cached identity
 *      whenever that predicate says no and a cached identity exists.
 *
 * The practice needs nothing from the server: starting a sit, watching the
 * timer, tapping thoughts, finishing. Internet is required for exactly one
 * thing — *syncing*. Knowing who you are is not syncing, so a request that
 * never reached the server must not be read as a sign-out. Before this, any
 * failed `me()` dropped the installed PWA on an auth error, which is precisely
 * what happens on a plane, on the subway, or in a dead zone.
 *
 * The asymmetry is deliberate. Wrongly deciding "offline" costs a 401 on the
 * next request and a trip to sign-in then; wrongly deciding "signed out"
 * destroys local state and is the bug this exists to prevent. Only an
 * authoritative signal gets to be destructive.
 *
 * **Two deliberate deviations from a literal port of the Swift classifier**,
 * both because the web surface produces answers the iOS `APIError` surface does
 * not, and both preserving the pre-#666 web behavior rather than inventing new:
 *
 * - `403` joins `401` as authoritative. iOS only ever sees `401` for a rejected
 *   session; the web bootstrap has always treated both as a rejection, and the
 *   #666 acceptance criteria name the pair.
 * - `404` is authoritative as `signedOut`. It is this route's "the session was
 *   valid but the account row is gone" answer (`/api/auth/me` returns
 *   `404 User not found` after a deletion) — the analogue of the iOS
 *   `applySignedOut(cause: .signedOut)` nil-user branch, not of a transport
 *   failure.
 *
 * Everything else the server said, and every answer that never arrived, stays
 * non-authoritative exactly as on iOS.
 */

/**
 * Why the app believes it may not have a session. Mirrors the iOS
 * `WidgetDataStore.SignedOutCause` taxonomy #676 introduced for the widget, so
 * the two clients can never disagree about what "signed out" means.
 */
export type SignedOutCause =
  /** The user signed out, or the server authoritatively reported no account. */
  | "signedOut"
  /** Credentials were rejected (HTTP 401/403) — the session is genuinely over. */
  | "unauthorized"
  /** The server answered, but with an error that says nothing about auth. */
  | "serverError"
  /** The server could not be reached at all (offline cold start). */
  | "unreachable";

/** A `me()` attempt that did not yield an authenticated user. */
export type MeFailure =
  /** The server answered with a non-2xx status. */
  | { kind: "status"; status: number }
  /** `fetch` rejected: no response ever arrived (offline, DNS, timeout, abort). */
  | { kind: "transport" };

/** What the app should do after a failed attempt to load the current user. */
export type AuthBootstrapOutcome = {
  /**
   * - `offline` — stay signed in and render from the cached identity.
   * - `signedOut` — the session is provably over; render sign-in.
   * - `unavailable` — no trustworthy answer *and* nothing cached to render;
   *   render the retryable error. This is the web's rendering of the iOS
   *   `.signedOut(cause)` "nothing to fall back to" branch: like it, it clears
   *   nothing, because the cause was never authoritative.
   */
  action: "offline" | "signedOut" | "unavailable";
  cause: SignedOutCause;
  /**
   * The single answer to "may this cause destroy account-scoped local state?",
   * resolved once here so routing, the cached identity and the tracking-unlock
   * reset cannot drift apart by each asking separately.
   */
  clearsLocalState: boolean;
  /** Whether the app is about to run from its local copy. Drives the indicator. */
  usesCachedIdentity: boolean;
};

/**
 * Map a failed `me()` onto the shared sign-out taxonomy.
 *
 * Only an answer that came *from the server* and was *about auth* counts as
 * proof the session is over. A response-less failure is `unreachable`; a status
 * the transport never produced (`<= 0`, how some clients model a dead network)
 * is treated the same way, mirroring the Swift `status <= 0` branch.
 */
export function signedOutCauseFor(failure: MeFailure): SignedOutCause {
  if (failure.kind === "transport") return "unreachable";
  const { status } = failure;
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "signedOut";
  if (status <= 0) return "unreachable";
  return "serverError";
}

/**
 * The one predicate for "is this cause authoritative enough to destroy local
 * state?" — the direct mirror of `WidgetDataStore.shouldClearStoredSnapshot`.
 * A dropped connection or a 5xx is never one of them.
 */
export function mayClearAccountScopedState(cause: SignedOutCause): boolean {
  return cause === "signedOut" || cause === "unauthorized";
}

/**
 * Resolve a failed `me()` into a route.
 *
 * `hasCachedUser` is the caller's answer for `loadCachedUser() !== null`;
 * without a local copy there is nothing to render, so even a transport failure
 * has to land somewhere else (a first launch with no network, say).
 */
export function resolveAuthBootstrap(
  failure: MeFailure,
  hasCachedUser: boolean,
): AuthBootstrapOutcome {
  const cause = signedOutCauseFor(failure);
  const clearsLocalState = mayClearAccountScopedState(cause);

  if (clearsLocalState || !hasCachedUser) {
    return {
      action: clearsLocalState ? "signedOut" : "unavailable",
      cause,
      clearsLocalState,
      usesCachedIdentity: false,
    };
  }

  return { action: "offline", cause, clearsLocalState: false, usesCachedIdentity: true };
}

/**
 * Status line for a route away from the app. Unchanged from the pre-#666
 * copy — a server problem and a dead network read differently to the user, and
 * both are retryable.
 */
export function authErrorMessageFor(cause: SignedOutCause): string {
  return cause === "unreachable"
    ? "Unable to verify your sign-in due to a network issue. Please retry."
    : "Unable to verify your sign-in due to a server issue. Please retry.";
}
