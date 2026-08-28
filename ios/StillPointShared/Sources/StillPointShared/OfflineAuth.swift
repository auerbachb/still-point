import Foundation

/// #665 — offline-first identity: what a failed `/api/auth/me` means for routing
/// and for the local state the app already holds.
///
/// The practice itself needs nothing from the server: starting a sit, watching
/// the timer, tapping thoughts, finishing. Internet is required for exactly one
/// thing — *syncing*. Knowing who you are is not syncing, so a request that never
/// reached the server must not be read as a sign-out. Before this, any failed
/// `me()` dropped the user on the sign-in screen, which is precisely what happens
/// on a plane, on the subway, or in a dead zone: the one place a meditation app is
/// most useful is where it stopped working.
///
/// The decision lives here, once, and is expressed in the taxonomy #676 already
/// introduced for the widget (`WidgetDataStore.SignedOutCause`) rather than a
/// second parallel one — so the app and the widget can never disagree about what
/// "signed out" means. `WidgetDataStore.shouldClearStoredSnapshot(on:)` remains
/// the single predicate for "is this cause authoritative enough to destroy local
/// state?"; this type only applies that same predicate to the app's own two
/// pieces of local state: the cached identity and the route.
///
/// **Pattern notes for #666 (web PWA).** Everything here is pure and has no
/// platform dependencies. A TypeScript mirror needs the same three moving parts:
/// (1) a classifier that treats only an HTTP 401 as proof the session is over,
/// (2) one shared predicate deciding whether a cause may destroy local state, and
/// (3) an outcome that keeps the user signed in from a cached identity whenever
/// that predicate says no and a cached identity exists.
public enum OfflineAuth {

    /// What the app should do after an attempt to load the current user failed.
    public enum Outcome: Sendable, Equatable {
        /// Authoritative: there is no usable session, or there is nothing local
        /// to fall back to. Route to sign-in; `cause` decides whether local state
        /// is cleared on the way.
        case signedOut(WidgetDataStore.SignedOutCause)
        /// No trustworthy answer — but a cached identity exists. Stay signed in
        /// and render from local state until the server can be reached again.
        case offline(WidgetDataStore.SignedOutCause)

        public var cause: WidgetDataStore.SignedOutCause {
            switch self {
            case let .signedOut(cause), let .offline(cause):
                return cause
            }
        }

        /// Whether the app is about to run from its local copy of identity/state.
        /// Drives the unobtrusive offline indicator.
        public var usesCachedIdentity: Bool {
            if case .offline = self { return true }
            return false
        }
    }

    /// Map a thrown `me()` error onto the shared sign-out taxonomy.
    ///
    /// Only an HTTP 401 counts as proof the session is over: it is the one answer
    /// that came *from the server* and was *about auth*. A response-less failure
    /// is `.unreachable` — that covers a real `URLError` and `APIError(status: 0)`,
    /// which is how `UITestAPIStore` models a dead network. Anything else the
    /// server said, and any answer we could not parse, is `.serverError`.
    ///
    /// The asymmetry is deliberate. Wrongly deciding "offline" costs a 401 on the
    /// next request and a trip to sign-in then; wrongly deciding "signed out"
    /// destroys local state and is the bug this exists to prevent. Only an
    /// authoritative signal gets to be destructive.
    public static func cause(for error: Error) -> WidgetDataStore.SignedOutCause {
        if let apiError = error as? APIError {
            if apiError.status == 401 { return .unauthorized }
            return apiError.status <= 0 ? .unreachable : .serverError
        }
        if error is URLError { return .unreachable }
        return .serverError
    }

    /// Resolve a failed `me()` into a route.
    ///
    /// `hasCachedIdentity` is the caller's answer for `CachedIdentityStore.load()`;
    /// without a local copy there is nothing to render, so even a transport failure
    /// has to land on sign-in (a first launch with no network, say).
    public static func outcome(for error: Error, hasCachedIdentity: Bool) -> Outcome {
        let cause = cause(for: error)
        // Deliberately the widget's predicate: a cause that may wipe the widget's
        // stored week is exactly a cause that may sign you out of the app.
        guard !WidgetDataStore.shouldClearStoredSnapshot(on: cause), hasCachedIdentity else {
            return .signedOut(cause)
        }
        return .offline(cause)
    }
}
