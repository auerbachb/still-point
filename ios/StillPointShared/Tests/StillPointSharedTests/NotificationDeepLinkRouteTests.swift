import Foundation
import Testing
@testable import StillPointShared

/// #832: which URLs `handleNotificationDeepLink` claims, and which fall through to
/// the next route in `handleIncomingURL`.
struct NotificationDeepLinkRouteTests {
    private func route(_ string: String, sourceLocation: SourceLocation = #_sourceLocation) -> NotificationDeepLinkRoute? {
        guard let url = URL(string: string) else {
            Issue.record("Not a URL: \(string)", sourceLocation: sourceLocation)
            return nil
        }
        return NotificationDeepLinkRoute.route(for: url)
    }

    // MARK: Recognized hosts

    @Test func testHomeRoutesHome() {
        #expect(route("stillpoint://home") == .home)
    }

    @Test func testFriendsRoutesToFriends() {
        #expect(route("stillpoint://friends") == .friends)
    }

    @Test func testLogReasonWithADateRoutesToLogReason() {
        #expect(route("stillpoint://log-reason?date=2024-05-01") == .logReason)
    }

    @Test func testLogReasonWithoutADateRoutesToLogReason() {
        #expect(route("stillpoint://log-reason") == .logReason)
    }

    // MARK: Case-insensitive matching

    @Test func testSchemeAndHostMatchIgnoringCase() {
        #expect(route("STILLPOINT://Home") == .home)
        #expect(route("StillPoint://FRIENDS") == .friends)
        #expect(route("StillPoint://LOG-REASON") == .logReason)
    }

    // MARK: Not a notification link

    @Test func testAnotherSchemeIsNotANotificationLink() {
        #expect(route("https://stillpoint.app/home") == nil)
        #expect(route("https://home") == nil)
    }

    @Test func testAnUnknownHostIsNotANotificationLink() {
        #expect(route("stillpoint://settings") == nil)
    }

    @Test func testAURLWithNoHostIsNotANotificationLink() {
        #expect(route("stillpoint:") == nil)
        #expect(route("stillpoint:///home") == nil)
    }

    @Test func testAURLWithNoSchemeIsNotANotificationLink() {
        #expect(route("home") == nil)
    }

    @Test func testSessionLinksFallThroughToTheirOwnRoute() {
        #expect(route("stillpoint://session") == nil)
        #expect(route("stillpoint://session/quick") == nil)
    }

    @Test func testBuddyLinksFallThroughToBuddyParsing() {
        #expect(route("stillpoint://buddy/abc") == nil)
    }

    // MARK: Precedence

    /// The notification route claims the URL before buddy parsing, so a buddy query
    /// on a recognized host does not change the route.
    @Test func testAQueryOnARecognizedHostDoesNotChangeTheRoute() {
        #expect(route("stillpoint://home?buddy=x") == .home)
        #expect(route("stillpoint://friends?token=abc") == .friends)
    }

    @Test func testAPathOnARecognizedHostDoesNotChangeTheRoute() {
        #expect(route("stillpoint://home/anything") == .home)
    }
}
