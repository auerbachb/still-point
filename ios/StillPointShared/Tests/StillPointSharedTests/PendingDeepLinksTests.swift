import Testing
@testable import StillPointShared

/// #1061: the pending-link lifecycle `DeepLinkCoordinator` applies. Four stages, as
/// Issue #1061 names them: queued while signed out, consumed after sign-in, suppressed
/// while in a session, and dropped on sign-out.
struct PendingDeepLinksTests {
    // MARK: - Queued while signed out

    @Test func testASessionLinkIsQueuedWhileSignedOut() {
        var links = PendingDeepLinks()
        #expect(links.receiveSession(.breath, isSignedIn: false, isInSession: false) == .queued)
        #expect(links.sessionType == .breath)
    }

    @Test func testALogReasonLinkIsQueuedWhileSignedOut() {
        var links = PendingDeepLinks()
        #expect(links.receiveLogReason(date: "2026-10-01", isSignedIn: false, isInSession: false) == .queued)
        #expect(links.logReasonDate == "2026-10-01")
    }

    @Test func testABuddyInviteIsHeldWhileSignedOut() {
        var links = PendingDeepLinks()
        #expect(links.receiveBuddyInvite(token: "tok-a", isSignedIn: false, isInSession: false) == .held)
        #expect(links.buddyInviteToken == "tok-a")
    }

    /// One slot per kind, not a queue: the newest link replaces the older one.
    @Test func testANewerLinkOfTheSameKindReplacesTheQueuedOne() {
        var links = PendingDeepLinks()
        _ = links.receiveSession(.standard, isSignedIn: false, isInSession: false)
        _ = links.receiveSession(.breath, isSignedIn: false, isInSession: false)
        _ = links.receiveLogReason(date: "2026-10-01", isSignedIn: false, isInSession: false)
        _ = links.receiveLogReason(date: "2026-10-02", isSignedIn: false, isInSession: false)
        _ = links.receiveBuddyInvite(token: "tok-a", isSignedIn: false, isInSession: false)
        _ = links.receiveBuddyInvite(token: "tok-b", isSignedIn: false, isInSession: false)

        #expect(links == PendingDeepLinks(sessionType: .breath, logReasonDate: "2026-10-02", buddyInviteToken: "tok-b"))
    }

    /// Nothing is taken while nobody is signed in.
    @Test func testNothingIsTakenWhileSignedOut() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01")
        #expect(links.takeSession(isSignedIn: false, isInSession: false) == nil)
        #expect(links.takeLogReason(isSignedIn: false, isInSession: false) == nil)
        #expect(links.sessionType == .standard)
        #expect(links.logReasonDate == "2026-10-01")
    }

    // MARK: - Consumed after sign-in

    @Test func testAQueuedSessionLinkIsTakenOnceAfterSignIn() {
        var links = PendingDeepLinks(sessionType: .breath)
        #expect(links.takeSession(isSignedIn: true, isInSession: false) == .breath)
        #expect(links.takeSession(isSignedIn: true, isInSession: false) == nil)
        #expect(links.sessionType == nil)
    }

    @Test func testAQueuedLogReasonIsTakenOnceAfterSignIn() {
        var links = PendingDeepLinks(logReasonDate: "2026-10-01")
        #expect(links.takeLogReason(isSignedIn: true, isInSession: false) == "2026-10-01")
        #expect(links.takeLogReason(isSignedIn: true, isInSession: false) == nil)
    }

    /// `applyAuthenticatedUser`'s order: the buddy invite is offered first, then the
    /// session link, then the log reason. The session link starts a sit, so the log
    /// reason waits for that sit to end.
    @Test func testTheSignInOrderLeavesTheLogReasonQueuedBehindTheSessionItStarts() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01", buddyInviteToken: "tok-a")
        var inSession = false

        // The buddy consume runs on a later main-actor turn; the token stays pending.
        #expect(links.buddyInviteToken == "tok-a")

        #expect(links.takeSession(isSignedIn: true, isInSession: inSession) == .standard)
        inSession = true

        #expect(links.takeLogReason(isSignedIn: true, isInSession: inSession) == nil)
        #expect(links.logReasonDate == "2026-10-01")

        inSession = false
        #expect(links.takeLogReason(isSignedIn: true, isInSession: inSession) == "2026-10-01")
    }

    @Test func testSignedInAndIdleOpensANewLinkAndQueuesNothing() {
        var links = PendingDeepLinks()
        #expect(links.receiveSession(.focus, isSignedIn: true, isInSession: false) == .open(.focus))
        #expect(links.receiveLogReason(date: "2026-10-01", isSignedIn: true, isInSession: false) == .open("2026-10-01"))
        #expect(links.receiveBuddyInvite(token: "tok-a", isSignedIn: true, isInSession: false) == .scheduleConsume)
        #expect(links == PendingDeepLinks(buddyInviteToken: "tok-a"))
    }

    @Test func testSignedInAndIdleOpeningANewLinkDropsTheOlderQueuedOne() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01")
        #expect(links.receiveSession(.focus, isSignedIn: true, isInSession: false) == .open(.focus))
        #expect(links.receiveLogReason(date: "2026-10-02", isSignedIn: true, isInSession: false) == .open("2026-10-02"))
        #expect(links.takeSession(isSignedIn: true, isInSession: false) == nil)
        #expect(links.takeLogReason(isSignedIn: true, isInSession: false) == nil)
        #expect(links.isEmpty)
    }

    // MARK: - Suppressed while in a session

    @Test func testANewLinkDuringASessionIsIgnoredAndKeepsTheQueuedOne() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01")
        #expect(links.receiveSession(.breath, isSignedIn: true, isInSession: true) == .ignored)
        #expect(links.receiveLogReason(date: "2026-10-02", isSignedIn: true, isInSession: true) == .ignored)
        #expect(links.sessionType == .standard)
        #expect(links.logReasonDate == "2026-10-01")
    }

    @Test func testANewLinkDuringASessionLeavesAnEmptySlotEmpty() {
        var links = PendingDeepLinks()
        #expect(links.receiveSession(.breath, isSignedIn: true, isInSession: true) == .ignored)
        #expect(links.receiveLogReason(date: "2026-10-02", isSignedIn: true, isInSession: true) == .ignored)
        #expect(links.isEmpty)
    }

    @Test func testNothingIsTakenDuringASession() {
        var links = PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01")
        #expect(links.takeSession(isSignedIn: true, isInSession: true) == nil)
        #expect(links.takeLogReason(isSignedIn: true, isInSession: true) == nil)
        #expect(links == PendingDeepLinks(sessionType: .standard, logReasonDate: "2026-10-01"))
    }

    @Test func testABuddyInviteDuringASessionIsStoredButNotScheduled() {
        var links = PendingDeepLinks()
        #expect(links.receiveBuddyInvite(token: "tok-a", isSignedIn: true, isInSession: true) == .held)
        #expect(links.buddyInviteToken == "tok-a")
    }

    // MARK: - Dropped on sign-out

    /// Log Out (`didLogout()`) drops every pending link.
    @Test func testExplicitLogoutDropsEveryPendingLink() {
        var links = PendingDeepLinks(sessionType: .breath, logReasonDate: "2026-10-01", buddyInviteToken: "tok-a")
        links.clearAll()
        #expect(links.isEmpty)
        #expect(links.takeSession(isSignedIn: true, isInSession: false) == nil)
        #expect(links.takeLogReason(isSignedIn: true, isInSession: false) == nil)
    }

    /// An automatic sign-out (`applySignedOut`) calls no clear, so the links stay and
    /// the next sign-in consumes them. This is current behavior, kept on purpose.
    @Test func testAutomaticSignOutKeepsTheLinksForTheNextSignIn() {
        var links = PendingDeepLinks(sessionType: .breath, logReasonDate: "2026-10-01", buddyInviteToken: "tok-a")
        // Signed out: still held, nothing taken.
        #expect(links.takeSession(isSignedIn: false, isInSession: false) == nil)
        #expect(links.buddyInviteToken == "tok-a")
        // Next sign-in.
        #expect(links.takeSession(isSignedIn: true, isInSession: false) == .breath)
        #expect(links.takeLogReason(isSignedIn: true, isInSession: false) == "2026-10-01")
    }

    // MARK: - Buddy replacement

    /// A consume clears only the token it captured. A newer invite stored during its
    /// request stays for the next consume (#756).
    @Test func testClearingAnOldTokenKeepsANewerReplacement() {
        var links = PendingDeepLinks(buddyInviteToken: "tok-a")
        _ = links.receiveBuddyInvite(token: "tok-b", isSignedIn: true, isInSession: false)
        links.clearBuddyInviteToken(ifEqualTo: "tok-a")
        #expect(links.buddyInviteToken == "tok-b")
    }

    @Test func testClearingTheCurrentTokenDropsIt() {
        var links = PendingDeepLinks(buddyInviteToken: "tok-a")
        links.clearBuddyInviteToken(ifEqualTo: "tok-a")
        #expect(links.buddyInviteToken == nil)
    }
}
