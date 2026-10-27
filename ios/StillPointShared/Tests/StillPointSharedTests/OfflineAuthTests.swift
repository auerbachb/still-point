import Foundation
import Testing
import StillPointShared

/// #665 — the routing half of offline-first. These cover the decision
/// `AppViewModel.checkAuth()` makes on a failed `me()`; the view model is a thin
/// switch over `OfflineAuth.outcome(for:hasCachedIdentity:)`, which lives in the
/// package so it is reachable from `swift test` (the app target is Xcode-only).
struct OfflineAuthTests {

    // MARK: - Transport failure keeps the user signed in

    /// AC: a connection error hydrates from the local copy and does NOT route to
    /// `.auth`.
    @Test func testTransportErrorWithCachedIdentityStaysSignedIn() {
        let outcome = OfflineAuth.outcome(
            for: URLError(.notConnectedToInternet),
            hasCachedIdentity: true
        )

        #expect(outcome == .offline(.unreachable))
        #expect(outcome.usesCachedIdentity)
    }

    @Test func testTimeoutWithCachedIdentityStaysSignedIn() {
        #expect(OfflineAuth.outcome(for: URLError(.timedOut), hasCachedIdentity: true) == .offline(.unreachable))
    }

    @Test func testNetworkConnectionLostWithCachedIdentityStaysSignedIn() {
        #expect(OfflineAuth.outcome(for: URLError(.networkConnectionLost), hasCachedIdentity: true) == .offline(.unreachable))
    }

    /// `UITestAPIStore` models a dead network as `APIError(status: 0)`, so the
    /// classifier has to read a response-less `APIError` as transport, not as
    /// something the server said.
    @Test func testResponselessAPIErrorIsTransportNotServerError() {
        let offline = APIError(status: 0, message: "No internet connection")

        #expect(OfflineAuth.cause(for: offline) == .unreachable)
        #expect(OfflineAuth.outcome(for: offline, hasCachedIdentity: true) == .offline(.unreachable))
    }

    /// A 5xx is the server answering with something that says nothing about auth —
    /// same treatment as unreachable, consistent with #676 refusing to wipe the
    /// widget's week on one.
    @Test func testServerErrorWithCachedIdentityStaysSignedIn() {
        let outcome = OfflineAuth.outcome(
            for: APIError(status: 500, message: "Internal Server Error"),
            hasCachedIdentity: true
        )

        #expect(outcome == .offline(.serverError))
        #expect(outcome.usesCachedIdentity)
    }

    /// A response we cannot parse is still an answer from a reachable server, so it
    /// classifies as `.serverError` — but it is just as non-authoritative, and the
    /// user stays signed in.
    @Test func testUnparseableResponseIsNonAuthoritative() {
        struct Undecodable: Error {}

        #expect(OfflineAuth.cause(for: Undecodable()) == .serverError)
        #expect(OfflineAuth.outcome(for: Undecodable(), hasCachedIdentity: true) == .offline(.serverError))
    }

    // MARK: - Authoritative rejection still signs out

    /// AC: a 401 `TOKEN_EXPIRED` still routes to `.auth` and clears cached identity
    /// (the clearing predicate is asserted in `CachedIdentityStoreTests`).
    @Test func testTokenExpiredRoutesToAuthEvenWithCachedIdentity() {
        let expired = APIError(status: 401, message: "Session expired. Please log in again.", code: "TOKEN_EXPIRED")
        let outcome = OfflineAuth.outcome(for: expired, hasCachedIdentity: true)

        #expect(outcome == .signedOut(.unauthorized))
        #expect(!outcome.usesCachedIdentity)
        #expect(WidgetDataStore.shouldClearStoredSnapshot(on: outcome.cause))
    }

    /// A 401 without the `TOKEN_EXPIRED` code is just as authoritative.
    @Test func testUncodedUnauthorizedRoutesToAuth() {
        #expect(OfflineAuth.outcome(for: APIError(status: 401, message: "Unauthorized"), hasCachedIdentity: true) == .signedOut(.unauthorized))
    }

    // MARK: - Nothing cached to fall back on

    /// First launch with no network: there is no local copy to render, so sign-in
    /// (with the connection message) remains the only honest destination.
    @Test func testTransportErrorWithoutCachedIdentityRoutesToAuth() {
        let outcome = OfflineAuth.outcome(
            for: URLError(.notConnectedToInternet),
            hasCachedIdentity: false
        )

        #expect(outcome == .signedOut(.unreachable))
        #expect(!outcome.usesCachedIdentity)
        // …but it is still not an authoritative sign-out, so nothing local is wiped.
        #expect(!WidgetDataStore.shouldClearStoredSnapshot(on: outcome.cause))
    }

    @Test func testServerErrorWithoutCachedIdentityRoutesToAuth() {
        #expect(OfflineAuth.outcome(for: APIError(status: 503, message: "Unavailable"), hasCachedIdentity: false) == .signedOut(.serverError))
    }

    // MARK: - One taxonomy, shared with the widget (#676)

    /// The app must never sign the user out on a cause that #676 already decided is
    /// too weak to wipe the widget's snapshot. Locking the two together here is what
    /// stops a second convention from appearing later.
    @Test func testRoutingAgreesWithWidgetSnapshotClearing() {
        let causes: [WidgetDataStore.SignedOutCause] = [.signedOut, .unauthorized, .serverError, .unreachable]
        let errors: [Error] = [
            APIError(status: 401, message: "Unauthorized"),
            APIError(status: 500, message: "Boom"),
            APIError(status: 0, message: "No internet connection"),
            URLError(.notConnectedToInternet),
        ]

        for error in errors {
            let outcome = OfflineAuth.outcome(for: error, hasCachedIdentity: true)
            #expect(
                outcome.usesCachedIdentity == !WidgetDataStore.shouldClearStoredSnapshot(on: outcome.cause),
                "Routing and snapshot-clearing disagreed for \(error)"
            )
        }

        // The `.signedOut` cause has no error to classify (it is `me()` returning
        // nil), but it must remain destructive.
        #expect(WidgetDataStore.shouldClearStoredSnapshot(on: .signedOut))
        #expect(causes.count == 4, "A new cause needs a routing decision here")
    }

    @Test func testCauseMapping() {
        #expect(OfflineAuth.cause(for: APIError(status: 401, message: "x")) == .unauthorized)
        #expect(OfflineAuth.cause(for: APIError(status: 403, message: "x")) == .serverError)
        #expect(OfflineAuth.cause(for: APIError(status: 500, message: "x")) == .serverError)
        #expect(OfflineAuth.cause(for: APIError(status: 0, message: "x")) == .unreachable)
        #expect(OfflineAuth.cause(for: URLError(.cannotFindHost)) == .unreachable)
        #expect(OfflineAuth.cause(for: URLError(.dnsLookupFailed)) == .unreachable)
    }
}
