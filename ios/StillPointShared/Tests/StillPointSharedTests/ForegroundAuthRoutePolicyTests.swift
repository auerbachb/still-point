import XCTest
@testable import StillPointShared

/// Issue #852 — `checkAuth()` runs on every scene activation, so an online `me()` that
/// re-confirms the account can land mid-sit. These tests pin what that check may do
/// to the screen: keep a sit for the same account, reset otherwise, and never cover a
/// sit with the loading overlay.
final class ForegroundAuthRoutePolicyTests: XCTestCase {
    /// Cold start: nothing is on screen yet and the adoption moves the generation
    /// from no account to an account. The route resets to the initial view.
    func testColdStartResetsTheRoute() {
        XCTAssertTrue(ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: false, identityChanged: true))
    }

    /// A foreground re-check outside a session, for the same account, resets the route
    /// as it always has.
    func testSameAccountRecheckAtRestResetsTheRoute() {
        XCTAssertTrue(ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: false, identityChanged: false))
    }

    /// The #852 case. The user returns to the app mid-sit and the check re-confirms
    /// the same account. The sit stays on screen and the badges are kept.
    func testSameAccountRecheckDuringASessionKeepsTheRoute() {
        XCTAssertFalse(ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: true, identityChanged: false))
    }

    /// The check adopted a different account while a sit was on screen. That sit
    /// belongs to the previous account, so the route resets.
    func testAccountChangeDuringASessionResetsTheRoute() {
        XCTAssertTrue(ForegroundAuthRoutePolicy.shouldResetRoute(isInSession: true, identityChanged: true))
    }

    /// Outside a session the overlay covers the screen while `me()` is in flight.
    func testOverlayIsRaisedAtRest() {
        XCTAssertTrue(ForegroundAuthRoutePolicy.shouldRaiseLoadingOverlay(isInSession: false))
    }

    /// During a session the overlay would hide the timer, so it stays down.
    func testOverlayIsNotRaisedDuringASession() {
        XCTAssertFalse(ForegroundAuthRoutePolicy.shouldRaiseLoadingOverlay(isInSession: true))
    }
}
