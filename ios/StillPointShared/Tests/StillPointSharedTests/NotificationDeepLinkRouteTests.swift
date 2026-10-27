import XCTest
@testable import StillPointShared

/// #832: which URLs `handleNotificationDeepLink` claims, and which fall through to
/// the next route in `handleIncomingURL`.
final class NotificationDeepLinkRouteTests: XCTestCase {
    private func route(_ string: String, file: StaticString = #filePath, line: UInt = #line) -> NotificationDeepLinkRoute? {
        guard let url = URL(string: string) else {
            XCTFail("Not a URL: \(string)", file: file, line: line)
            return nil
        }
        return NotificationDeepLinkRoute.route(for: url)
    }

    // MARK: Recognized hosts

    func testHomeRoutesHome() {
        XCTAssertEqual(route("stillpoint://home"), .home)
    }

    func testFriendsRoutesToFriends() {
        XCTAssertEqual(route("stillpoint://friends"), .friends)
    }

    func testLogReasonWithADateRoutesToLogReason() {
        XCTAssertEqual(route("stillpoint://log-reason?date=2024-05-01"), .logReason)
    }

    func testLogReasonWithoutADateRoutesToLogReason() {
        XCTAssertEqual(route("stillpoint://log-reason"), .logReason)
    }

    // MARK: Case-insensitive matching

    func testSchemeAndHostMatchIgnoringCase() {
        XCTAssertEqual(route("STILLPOINT://Home"), .home)
        XCTAssertEqual(route("StillPoint://FRIENDS"), .friends)
        XCTAssertEqual(route("StillPoint://LOG-REASON"), .logReason)
    }

    // MARK: Not a notification link

    func testAnotherSchemeIsNotANotificationLink() {
        XCTAssertNil(route("https://stillpoint.app/home"))
        XCTAssertNil(route("https://home"))
    }

    func testAnUnknownHostIsNotANotificationLink() {
        XCTAssertNil(route("stillpoint://settings"))
    }

    func testAURLWithNoHostIsNotANotificationLink() {
        XCTAssertNil(route("stillpoint:"))
        XCTAssertNil(route("stillpoint:///home"))
    }

    func testAURLWithNoSchemeIsNotANotificationLink() {
        XCTAssertNil(route("home"))
    }

    func testSessionLinksFallThroughToTheirOwnRoute() {
        XCTAssertNil(route("stillpoint://session"))
        XCTAssertNil(route("stillpoint://session/quick"))
    }

    func testBuddyLinksFallThroughToBuddyParsing() {
        XCTAssertNil(route("stillpoint://buddy/abc"))
    }

    // MARK: Precedence

    /// The notification route claims the URL before buddy parsing, so a buddy query
    /// on a recognized host does not change the route.
    func testAQueryOnARecognizedHostDoesNotChangeTheRoute() {
        XCTAssertEqual(route("stillpoint://home?buddy=x"), .home)
        XCTAssertEqual(route("stillpoint://friends?token=abc"), .friends)
    }

    func testAPathOnARecognizedHostDoesNotChangeTheRoute() {
        XCTAssertEqual(route("stillpoint://home/anything"), .home)
    }
}
