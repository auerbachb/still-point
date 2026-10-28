import Testing
@testable import StillPointShared

/// What `didLogin(user:)`'s catch-up and `returnHome()` act on once their buddy-invite
/// join returns: the identity generation, who is signed in, and the pending session and
/// log-reason links. Main-actor isolated, like `AppViewModel`, whose state this stands
/// in for.
@MainActor
private final class PendingLinkScreen {
    enum Link: Equatable {
        /// `PendingDeepLinks.sessionType`.
        case session
        /// `PendingDeepLinks.logReasonDate`.
        case logReason
    }

    struct Opened: Equatable {
        let link: Link
        /// Who was signed in when the link opened.
        let account: String
    }

    /// `AppViewModel.authGeneration`.
    private(set) var generation = 1
    /// `AppViewModel.currentUser?.id`.
    private(set) var signedIn: String?
    private(set) var pending: [Link]
    /// `isInSession`. Opening the session link starts a sit, and the log-reason link
    /// then waits for it to end.
    private(set) var inSit = false
    /// The links the tail opened, in order.
    private(set) var opened: [Opened] = []

    init(signedIn account: String, pending: [Link]) {
        signedIn = account
        self.pending = pending
    }

    /// `applyAuthenticatedUser`: an identity transition only when the account changes.
    func adopt(_ account: String) {
        if signedIn != account { generation += 1 }
        signedIn = account
    }

    /// `didLogout()`: always a transition, and it clears the pending links.
    func logOut() {
        generation += 1
        signedIn = nil
        inSit = false
        pending = []
    }

    /// `applySignedOut(cause:message:)`: always a transition, and it keeps the pending
    /// links for the next sign-in.
    func signOutKeepingLinks() {
        generation += 1
        signedIn = nil
        inSit = false
    }

    /// A link that arrives while nobody is signed in waits for the next sign-in
    /// (`openSessionDeepLink`, `openLogReason`).
    func queue(_ link: Link) {
        pending.append(link)
    }

    /// The end of `didLogin(user:)`'s catch-up: the join, then both local links.
    func startSignInTail(afterJoining join: HeldSave<Void>) -> Task<Void, Never> {
        startTail(opening: [.session, .logReason], afterJoining: join)
    }

    /// The end of `returnHome()`: the join, then the log-reason link.
    func startReturnHomeTail(afterJoining join: HeldSave<Void>) -> Task<Void, Never> {
        startTail(opening: [.logReason], afterJoining: join)
    }

    /// Both tails read the generation before the join and re-check it once the join
    /// returns, before the first local link.
    private func startTail(opening links: [Link], afterJoining join: HeldSave<Void>) -> Task<Void, Never> {
        let generation = self.generation
        return Task {
            await join.perform()
            guard AuthCheckOwnership.ownsLocalLinks(
                startedAtGeneration: generation,
                liveGeneration: self.generation
            ) else { return }
            for link in links {
                open(link)
            }
        }
    }

    /// `consumePendingSessionDeepLinkIfNeeded` and `consumePendingLogReasonIfNeeded`.
    /// Each needs someone signed in, no sit running, and its own link pending.
    private func open(_ link: Link) {
        guard let account = signedIn, !inSit, let index = pending.firstIndex(of: link) else { return }
        pending.remove(at: index)
        opened.append(Opened(link: link, account: account))
        if link == .session { inSit = true }
    }
}

/// Issue #857: `didLogin(user:)`'s catch-up and `returnHome()` join a pending buddy
/// invite, then open the pending local links: the session and log-reason links after a
/// sign-in, the log-reason link after a sit. The join is a network request, so a
/// sign-out and a sign-in can land before it returns, and the links pending by then
/// are for the account signed in by then. That account's own sign-in opens them in its
/// own order. Each test holds the join open across the transitions and checks what the
/// tail may still open when it resumes. Without the re-check after the join, each tail
/// below that a sign-in or an account switch ends would open the links anyway.
@MainActor
struct AuthCheckOwnershipLocalLinksTests {
    /// AC 4. With nothing landing during the join, a sign-in opens its links as before.
    /// The session link starts a sit, and the log-reason link waits behind it.
    @Test func testALoneSignInOpensItsPendingLinks() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.session, .logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startSignInTail(afterJoining: join)
        await join.untilStarted()

        join.settle()

        await tail.value
        #expect(screen.opened == [.init(link: .session, account: "user-a")])
        #expect(screen.pending == [.logReason])
    }

    /// AC 4. A lone `returnHome()` opens the log-reason link that waited behind the sit.
    @Test func testALoneReturnHomeOpensThePendingLogReasonLink() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startReturnHomeTail(afterJoining: join)
        await join.untilStarted()

        join.settle()

        await tail.value
        #expect(screen.opened == [.init(link: .logReason, account: "user-a")])
        #expect(screen.pending == [])
    }

    /// A `checkAuth()` or reconnect refresh that re-confirms the same account during the
    /// join is not an identity change, so the tail still opens the link.
    @Test func testReconfirmingTheSameAccountDuringTheJoinKeepsTheTail() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startReturnHomeTail(afterJoining: join)
        await join.untilStarted()

        screen.adopt("user-a")
        join.settle()

        await tail.value
        #expect(screen.opened == [.init(link: .logReason, account: "user-a")])
    }

    /// Log Out (`didLogout()`) clears A's links. A log-reason link that arrives before B
    /// signs in is B's. Nothing cancels the task running `returnHome()`, so A's tail can
    /// still be joining when B signs in, and it must leave the link to B.
    @Test func testALogOutAndAnotherSignInDuringTheJoinLeaveTheNextAccountsLinkPending() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startReturnHomeTail(afterJoining: join)
        await join.untilStarted()

        screen.logOut()
        screen.queue(.logReason)
        screen.adopt("user-b")
        join.settle()

        await tail.value
        #expect(screen.opened == [], "A's tail opened B's link outside B's own sign-in")
        #expect(screen.pending == [.logReason])
    }

    /// An expired or rejected session (`applySignedOut`) keeps the pending links for the
    /// next sign-in on purpose. They are B's to open, not A's tail's.
    @Test func testAnAuthDrivenSignOutAndAnotherSignInDuringTheJoinLeaveTheKeptLinkPending() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startReturnHomeTail(afterJoining: join)
        await join.untilStarted()

        screen.signOutKeepingLinks()
        screen.adopt("user-b")
        join.settle()

        await tail.value
        #expect(screen.opened == [], "A's tail opened the kept link outside B's own sign-in")
        #expect(screen.pending == [.logReason])
    }

    /// Signing out and back in as A is two identity changes, so the old tail ends here
    /// too. A's new sign-in opens the link in its own order.
    @Test func testSigningBackInAsTheSameAccountDuringTheJoinStillEndsTheTail() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startReturnHomeTail(afterJoining: join)
        await join.untilStarted()

        screen.signOutKeepingLinks()
        screen.adopt("user-a")
        join.settle()

        await tail.value
        #expect(screen.opened == [])
        #expect(screen.pending == [.logReason])
    }

    /// The case that reaches `didLogin(user:)`'s catch-up. A sign-out cancels that tail
    /// and its join, but adopting a different account cancels nothing: for example, a
    /// `checkAuth()` whose `me()` answers for someone else after another window signed
    /// in as them (#916).
    @Test func testAdoptingAnotherAccountDuringTheJoinEndsTheTail() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.session, .logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startSignInTail(afterJoining: join)
        await join.untilStarted()

        screen.adopt("user-b")
        join.settle()

        await tail.value
        #expect(screen.opened == [], "A's tail started a sit for B")
        #expect(screen.pending == [.session, .logReason])
    }

    /// A sign-out with nobody signed in yet when the join returns. The tail opens
    /// nothing, and the links wait for the next sign-in. The consumers' own
    /// `currentUser != nil` already held this before #857. It is how a `didLogin(user:)`
    /// tail that the sign-out cancelled usually ends.
    @Test func testASignOutAloneDuringTheJoinOpensNothing() async {
        let screen = PendingLinkScreen(signedIn: "user-a", pending: [.session, .logReason])
        let join = HeldSave(settlingWith: ())
        let tail = screen.startSignInTail(afterJoining: join)
        await join.untilStarted()

        screen.signOutKeepingLinks()
        join.settle()

        await tail.value
        #expect(screen.opened == [])
        #expect(screen.pending == [.session, .logReason])
    }
}
