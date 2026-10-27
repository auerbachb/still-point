import XCTest
@testable import StillPointShared

/// #1061: the pending-link lifecycle `DeepLinkCoordinator` applies. Four stages, as
/// Issue #1061 names them: queued while signed out, consumed after sign-in, suppressed
/// while in a session, and dropped on sign-out.
final class PendingDeepLinksTests: XCTestCase {
    // MARK: - Queued while signed out

    func testASessionLinkIsQueuedWhileSignedOut() {
        var links = PendingDeepLinks()
        XCTAssertEqual(links.receiveSession(.breath, isSignedIn: false, isInSession: false), .queued)
        XCTAssertEqual(links.sessionType, .breath)
    }

    func testALogReasonLinkIsQueuedWhileSignedOut() {
        var links = PendingDeepLinks()
        XCTAssertEqual(links.receiveLogReason(date: "2026-10-01", isSignedIn: false, isInSession: false), .queued)
        XCTAssertEqual(links.logReasonDate, "2026-10-01")
    }

    func testABuddyInviteIsHeldWhileSignedOut() {
        var links = PendingDeepLinks()
        XCTAssertEqual(links.receiveBuddyInvite(token: "tok-a", isSignedIn: false, isInSession: false), .held)
        XCTAssertEqual(links.buddyInviteToken, "tok-a")
    }

    /// One slot per kind, not a queue: the newest link replaces the older one.
    func testANewerLinkOfTheSameKindReplacesTheQueuedOne() {
        var links = PendingDeepLinks()
        _ = links.receiveSession(.standard, isSignedIn: false, isInSession: false)
        _ = links.receiveSession(.breath, isSignedIn: false, isInSession: false)
        _ = links.receiveLogReason(date: "2026-10-01", isSignedIn: false, isInSession: false)
        _ = links.receiveLogReason(date: "2026-10-02", isSignedIn: false, isInSession: false)
        _ = links.receiveBuddyInvite(token: "tok-a", isSignedIn: false, isInSession: false)
        _ = links.receiveBuddyInvite(token: "tok-b", isSignedIn: false, isInSession: false)

        XCTAssertEqual(links, PendingDeepLinks(sessionType: .breath, logReasonDate: "2026-10-02", buddyInviteToken: "tok-b"))
    }

    /// Nothing is taken while nobody is signed in.
    func testNothingIsTakenWhileSignedOut() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01")
        XCTAssertNil(links.takeSession(isSignedIn: false, isInSession: false))
        XCTAssertNil(links.takeLogReason(isSignedIn: false, isInSession: false))
        XCTAssertEqual(links.sessionType, .standard)
        XCTAssertEqual(links.logReasonDate, "2026-10-01")
    }

    // MARK: - Consumed after sign-in

    func testAQueuedSessionLinkIsTakenOnceAfterSignIn() {
        var links = PendingDeepLinks(sessionType: .breath)
        XCTAssertEqual(links.takeSession(isSignedIn: true, isInSession: false), .breath)
        XCTAssertNil(links.takeSession(isSignedIn: true, isInSession: false))
        XCTAssertNil(links.sessionType)
    }

    func testAQueuedLogReasonIsTakenOnceAfterSignIn() {
        var links = PendingDeepLinks(logReasonDate: "2026-10-01")
        XCTAssertEqual(links.takeLogReason(isSignedIn: true, isInSession: false), "2026-10-01")
        XCTAssertNil(links.takeLogReason(isSignedIn: true, isInSession: false))
    }

    /// `applyAuthenticatedUser`'s order: the buddy invite is offered first, then the
    /// session link, then the log reason. The session link starts a sit, so the log
    /// reason waits for that sit to end.
    func testTheSignInOrderLeavesTheLogReasonQueuedBehindTheSessionItStarts() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01", buddyInviteToken: "tok-a")
        var inSession = false

        // The buddy consume runs on a later main-actor turn; the token stays pending.
        XCTAssertEqual(links.buddyInviteToken, "tok-a")

        XCTAssertEqual(links.takeSession(isSignedIn: true, isInSession: inSession), .standard)
        inSession = true

        XCTAssertNil(links.takeLogReason(isSignedIn: true, isInSession: inSession))
        XCTAssertEqual(links.logReasonDate, "2026-10-01")

        inSession = false
        XCTAssertEqual(links.takeLogReason(isSignedIn: true, isInSession: inSession), "2026-10-01")
    }

    func testSignedInAndIdleOpensANewLinkWithoutTouchingTheSlot() {
        var links = PendingDeepLinks()
        XCTAssertEqual(links.receiveSession(.focus, isSignedIn: true, isInSession: false), .open(.focus))
        XCTAssertEqual(links.receiveLogReason(date: "2026-10-01", isSignedIn: true, isInSession: false), .open("2026-10-01"))
        XCTAssertEqual(links.receiveBuddyInvite(token: "tok-a", isSignedIn: true, isInSession: false), .scheduleConsume)
        XCTAssertEqual(links, PendingDeepLinks(buddyInviteToken: "tok-a"))
    }

    // MARK: - Suppressed while in a session

    func testANewLinkDuringASessionIsIgnoredAndKeepsTheQueuedOne() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01")
        XCTAssertEqual(links.receiveSession(.breath, isSignedIn: true, isInSession: true), .ignored)
        XCTAssertEqual(links.receiveLogReason(date: "2026-10-02", isSignedIn: true, isInSession: true), .ignored)
        XCTAssertEqual(links.sessionType, .standard)
        XCTAssertEqual(links.logReasonDate, "2026-10-01")
    }

    func testANewLinkDuringASessionLeavesAnEmptySlotEmpty() {
        var links = PendingDeepLinks()
        XCTAssertEqual(links.receiveSession(.breath, isSignedIn: true, isInSession: true), .ignored)
        XCTAssertEqual(links.receiveLogReason(date: "2026-10-02", isSignedIn: true, isInSession: true), .ignored)
        XCTAssertTrue(links.isEmpty)
    }

    func testNothingIsTakenDuringASession() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01")
        XCTAssertNil(links.takeSession(isSignedIn: true, isInSession: true))
        XCTAssertNil(links.takeLogReason(isSignedIn: true, isInSession: true))
        XCTAssertEqual(links, PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01"))
    }

    func testABuddyInviteDuringASessionIsStoredButNotScheduled() {
        var links = PendingDeepLinks()
        XCTAssertEqual(links.receiveBuddyInvite(token: "tok-a", isSignedIn: true, isInSession: true), .held)
        XCTAssertEqual(links.buddyInviteToken, "tok-a")
    }

    // MARK: - Dropped on sign-out

    /// Log Out (`didLogout()`) drops every pending link.
    func testExplicitLogoutDropsEveryPendingLink() {
        var links = PendingDeepLinks(sessionType: .breath, logReasonDate: "2026-10-01", buddyInviteToken: "tok-a")
        links.clearAll()
        XCTAssertTrue(links.isEmpty)
        XCTAssertNil(links.takeSession(isSignedIn: true, isInSession: false))
        XCTAssertNil(links.takeLogReason(isSignedIn: true, isInSession: false))
    }

    /// An automatic sign-out (`applySignedOut`) calls no clear, so the links stay and
    /// the next sign-in consumes them. This is current behavior, kept on purpose.
    func testAutomaticSignOutKeepsTheLinksForTheNextSignIn() {
        var links = PendingDeepLinks(sessionType: .breath, logReasonDate: "2026-10-01", buddyInviteToken: "tok-a")
        // Signed out: still held, nothing taken.
        XCTAssertNil(links.takeSession(isSignedIn: false, isInSession: false))
        XCTAssertEqual(links.buddyInviteToken, "tok-a")
        // Next sign-in.
        XCTAssertEqual(links.takeSession(isSignedIn: true, isInSession: false), .breath)
        XCTAssertEqual(links.takeLogReason(isSignedIn: true, isInSession: false), "2026-10-01")
    }

    // MARK: - Buddy replacement

    /// A consume clears only the token it captured. A newer invite stored during its
    /// request stays for the next consume (#756).
    func testClearingAnOldTokenKeepsANewerReplacement() {
        var links = PendingDeepLinks(buddyInviteToken: "tok-a")
        _ = links.receiveBuddyInvite(token: "tok-b", isSignedIn: true, isInSession: false)
        links.clearBuddyInviteToken(ifEqualTo: "tok-a")
        XCTAssertEqual(links.buddyInviteToken, "tok-b")
    }

    func testClearingTheCurrentTokenDropsIt() {
        var links = PendingDeepLinks(buddyInviteToken: "tok-a")
        links.clearBuddyInviteToken(ifEqualTo: "tok-a")
        XCTAssertNil(links.buddyInviteToken)
    }
}
