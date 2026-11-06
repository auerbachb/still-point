import Testing
@testable import StillPointShared

/// Issue #852 — `checkAuth()` runs on every scene activation, so an online `me()` that
/// re-confirms the account can land mid-sit. These tests pin what that check may do
/// to the screen: keep a sit for the same account, reset otherwise, and never cover a
/// sit with the loading overlay.
struct ForegroundAuthRoutePolicyTests {
    /// Cold start: nothing is on screen yet and the adoption moves the generation
    /// from no account to an account. The route resets to the initial view.
    @Test func testColdStartResetsTheRoute() {
        #expect(ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: false, identityChanged: true))
    }

    /// A foreground re-check outside a session, for the same account, resets the route
    /// as it always has.
    @Test func testSameAccountRecheckAtRestResetsTheRoute() {
        #expect(ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: false, identityChanged: false))
    }

    /// The #852 case. The user returns to the app mid-sit and the check re-confirms
    /// the same account. The sit stays on screen and the badges are kept.
    @Test func testSameAccountRecheckDuringASessionKeepsTheRoute() {
        #expect(!ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: true, identityChanged: false))
    }

    /// The check adopted a different account while a sit was on screen. That sit
    /// belongs to the previous account, so the route resets.
    @Test func testAccountChangeDuringASessionResetsTheRoute() {
        #expect(ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: true, identityChanged: true))
    }

    /// Outside a session the overlay covers the screen while `me()` is in flight.
    @Test func testOverlayIsShownAtRestWhileLoading() {
        #expect(ForegroundAuthRoutePolicy.shouldShowLoadingOverlay(isLoading: true, isInSession: false))
    }

    /// During a session the overlay would hide the timer, so it stays down. This also
    /// covers a sit that starts while the request is already in flight: the flag is
    /// up, but the overlay is not drawn over the session.
    @Test func testOverlayIsNotShownDuringASessionWhileLoading() {
        #expect(!ForegroundAuthRoutePolicy.shouldShowLoadingOverlay(isLoading: true, isInSession: true))
    }

    /// No request in flight, no overlay, wherever the user is.
    @Test func testOverlayIsNotShownWhenNotLoading() {
        #expect(!ForegroundAuthRoutePolicy.shouldShowLoadingOverlay(isLoading: false, isInSession: false))
        #expect(!ForegroundAuthRoutePolicy.shouldShowLoadingOverlay(isLoading: false, isInSession: true))
    }
}
