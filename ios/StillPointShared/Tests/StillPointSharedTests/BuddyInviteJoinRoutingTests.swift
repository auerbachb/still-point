import Testing
@testable import StillPointShared

/// What a buddy-invite join acts on once the server accepts it: the identity
/// generation, the screen, the pending invite, the consume's in-flight flag, and
/// whether the newest auth check has yet to reset the route. Main-actor isolated, like
/// `AppViewModel`, whose state this stands in for.
@MainActor
private final class InviteScreen {
    enum Screen: Equatable {
        case home
        /// A sit. Stands in for every screen `AppViewModel.isInSession` covers.
        case sit
        case buddySession(String)
        case signIn
    }

    /// `AppViewModel.authGeneration`.
    private(set) var generation = 1
    /// `AppViewModel.currentUser?.id`.
    private(set) var signedIn: String?
    /// `AppViewModel.currentView`.
    private(set) var screen = Screen.home
    /// `DeepLinkCoordinator.pendingLinks.buddyInviteToken`.
    private(set) var pendingInvite: String?
    /// Every invite a consume sent to the server, in order.
    private(set) var joinsSent: [String] = []
    /// `DeepLinkCoordinator.buddyInviteConsumeGate`.
    private var gate = BuddyInviteConsumeGate()
    /// `AppViewModel.activeAuthCheckID`.
    private var newestCheckID = 0
    /// `AppViewModel.isAuthCheckRouteResetPending`.
    private var routeResetPending = false

    init(signedIn account: String, pendingInvite invite: String) {
        signedIn = account
        pendingInvite = invite
    }

    private var isInSession: Bool {
        switch screen {
        case .sit, .buddySession: return true
        case .home, .signIn: return false
        }
    }

    /// `beginSession(type:track:)`, from Home or a session deep link.
    func startSit() {
        screen = .sit
    }

    /// The first line of `returnHome()`. Its invite consume comes later.
    func returnHome() {
        screen = .home
    }

    /// `applySignedOut(cause:message:)`: an identity change that keeps the pending
    /// invite. `didLogout()` clears it outright.
    func signOut() {
        generation += 1
        signedIn = nil
        screen = .signIn
    }

    /// `didLogin` adopting an account after a sign-out: a new generation.
    func signIn(_ account: String) {
        generation += 1
        signedIn = account
        screen = .home
    }

    /// `handleIncomingURL` storing a newer invite link.
    func receiveInvite(_ invite: String) {
        pendingInvite = invite
    }

    /// `checkAuth()` as it starts. It takes the next check ID, and its route reset is
    /// pending from here.
    func startCheck() -> Int {
        newestCheckID += 1
        routeResetPending = true
        return newestCheckID
    }

    /// `checkAuth()` once `me()` has re-confirmed the account: the route reset. Only
    /// the newest check gets this far (`AuthCheckOwnership.isCurrent`).
    func resetRoute(forCheck checkID: Int) {
        guard checkID == newestCheckID else { return }
        screen = .home
        routeResetPending = false
    }

    /// `checkAuth()`'s `defer`, on whichever path the check ends: after its reset, at
    /// the offline fallback, or superseded by a newer check.
    func endCheck(_ checkID: Int) {
        if checkID == newestCheckID { routeResetPending = false }
    }

    /// `consumePendingBuddyInviteIfNeeded`, the one route every caller joins through.
    func consumeInvite(joining join: HeldSave<String>) -> Task<Void, Never> {
        let generation = self.generation
        return Task {
            guard generation == self.generation, signedIn != nil, let invite = pendingInvite else { return }
            guard !isInSession,
                  let attempt = gate.acquire(generation: generation, token: invite) else { return }
            defer { gate.release(attempt) }
            joinsSent.append(invite)
            let sessionID = await join.perform()
            let decision = BuddyInviteJoinRouting.decision(
                startedAtGeneration: generation,
                liveGeneration: self.generation,
                isInSession: isInSession,
                routeResetPending: routeResetPending
            )
            if decision == .route {
                screen = .buddySession(sessionID)
            }
            // A moved generation drops this attempt's invite, so the next account does
            // not inherit it. Otherwise only a join that routed spends it.
            // Only this attempt's own invite: a newer one stored meanwhile is kept.
            if pendingInvite == invite, generation != self.generation || decision == .route {
                pendingInvite = nil
            }
        }
    }
}

/// Issue #856: a buddy-invite join decides whether to start before its request, and two
/// things can change while the request is in flight. The user can start a sit, or a
/// newer `checkAuth()` can start and later reset the route to the initial view. The
/// tests below pin the rule, then hold a join open across each change and check where
/// the user ends up and whether the invite survives. Without the two deferrals, each
/// test with a sit or a pending reset in that window would open the buddy session
/// anyway: over the sit, or on a screen the reset then replaces, with the invite spent.
@MainActor
struct BuddyInviteJoinRoutingTests {
    private func decision(
        startedAt generation: Int,
        live: Int,
        inSession: Bool,
        resetPending: Bool
    ) -> BuddyInviteJoinRouting.Decision {
        BuddyInviteJoinRouting.decision(
            startedAtGeneration: generation,
            liveGeneration: live,
            isInSession: inSession,
            routeResetPending: resetPending
        )
    }

    /// A later consume with nothing landing during its join: `returnHome()`, the newest
    /// check's own consume after its reset, or the reconnect refresh. The join is settled
    /// up front, so a consume that sends nothing returns rather than waiting on it.
    private func consumeAgain(on screen: InviteScreen, joining sessionID: String) async {
        let join = HeldSave(settlingWith: sessionID)
        join.settle()
        await screen.consumeInvite(joining: join).value
    }

    // MARK: - The rule

    /// With nothing changed during the request, the join opens the buddy session.
    @Test func testAJoinWithNothingInTheWayRoutes() {
        #expect(decision(startedAt: 1, live: 1, inSession: false, resetPending: false) == .route)
    }

    /// AC 2. A sit on screen keeps its screen, and the invite waits for it to end.
    @Test func testASessionOnScreenDefersTheJoin() {
        #expect(decision(startedAt: 1, live: 1, inSession: true, resetPending: false) == .deferForSession)
    }

    /// AC 3. The newest check has yet to reset the route, so routing now would be undone.
    @Test func testAPendingRouteResetDefersTheJoin() {
        #expect(decision(startedAt: 1, live: 1, inSession: false, resetPending: true) == .deferForRouteReset)
    }

    /// With both at once, the sit is the reason reported. The app treats the two
    /// deferrals the same, so this pins the order of the rule, not a behavior.
    @Test func testASessionOutranksAPendingRouteReset() {
        #expect(decision(startedAt: 1, live: 1, inSession: true, resetPending: true) == .deferForSession)
    }

    /// A join that outlived its account is stale whatever else is on screen (#665).
    @Test func testAMovedGenerationIsStaleEvenWhenADeferralWouldApply() {
        for inSession in [false, true] {
            for resetPending in [false, true] {
                #expect(
                    decision(startedAt: 1, live: 2, inSession: inSession, resetPending: resetPending) == .stale,
                    "inSession: \(inSession), resetPending: \(resetPending)"
                )
            }
        }
    }

    // MARK: - Late joins

    /// AC 5. With nothing landing during the request, the join opens the buddy session
    /// and spends the invite, as before.
    @Test func testALoneJoinOpensTheBuddySession() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()

        join.settle()

        await consume.value
        #expect(screen.screen == .buddySession("buddy-1"))
        #expect(screen.pendingInvite == nil)
        #expect(screen.joinsSent == ["invite-1"])
    }

    /// Gap 1 (AC 1, AC 2). The user starts a sit while the join is in flight: from Home,
    /// or from a session deep link. The join leaves the sit alone and keeps the invite.
    @Test func testASitStartedDuringTheJoinKeepsTheSitAndTheInvite() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()

        screen.startSit()
        join.settle()

        await consume.value
        #expect(screen.screen == .sit, "the late join replaced the sit")
        #expect(screen.pendingInvite == "invite-1")
    }

    /// The invite kept for a sit opens once the sit ends. `returnHome()` consumes it,
    /// and the server takes the second join as a rejoin.
    @Test func testTheInviteKeptForASitOpensWhenTheSitEnds() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()
        screen.startSit()
        join.settle()
        await consume.value

        screen.returnHome()
        await consumeAgain(on: screen, joining: "buddy-1")

        #expect(screen.screen == .buddySession("buddy-1"))
        #expect(screen.pendingInvite == nil)
        #expect(screen.joinsSent == ["invite-1", "invite-1"])
    }

    /// Gap 2 (AC 1, AC 3), in the order that lost the invite. A newer check starts while
    /// the join is in flight: a scene activation, or the app coming forward to open the
    /// invite link. The join returns before that check's route reset. It used to route
    /// and spend the invite, and the reset then sent the user Home. Now it defers, and
    /// the check consumes the invite after its reset.
    @Test func testAJoinReturningBeforeANewerChecksResetLeavesTheInviteToThatCheck() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()

        let check = screen.startCheck()
        join.settle()
        await consume.value
        #expect(screen.screen == .home, "the late join routed past the pending reset")
        #expect(screen.pendingInvite == "invite-1")

        screen.resetRoute(forCheck: check)
        await consumeAgain(on: screen, joining: "buddy-1")
        screen.endCheck(check)

        #expect(screen.screen == .buddySession("buddy-1"))
        #expect(screen.pendingInvite == nil)
        #expect(screen.joinsSent == ["invite-1", "invite-1"])
    }

    /// Gap 2 in the other order. The newer check's reset lands first, and its own
    /// consume returns at the in-flight flag. The check is still running when the join
    /// returns, so it is the reset, not the check's end, that lets the join route. The
    /// session opens and nothing joins twice. A join that deferred whenever *any* newer
    /// check had started would strand the invite here, because the check's consume has
    /// already come and gone.
    @Test func testAJoinReturningAfterTheNewerChecksResetStillOpensTheBuddySession() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()

        let check = screen.startCheck()
        screen.resetRoute(forCheck: check)
        await consumeAgain(on: screen, joining: "buddy-1")
        join.settle()
        await consume.value
        screen.endCheck(check)

        #expect(screen.screen == .buddySession("buddy-1"))
        #expect(screen.pendingInvite == nil)
        #expect(screen.joinsSent == ["invite-1"], "the check joined again while the first join was in flight")
    }

    /// Overlapping checks: a cold start's check and the first scene activation's, both
    /// started during the join. The join returns before either resets. The older check
    /// is superseded and ends without a reset, and that must not release the newest
    /// check's pending reset. The newest check then consumes the invite after its own.
    @Test func testAnOlderCheckEndingKeepsTheNewestChecksResetPending() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()

        let older = screen.startCheck()
        let newest = screen.startCheck()
        screen.resetRoute(forCheck: older)
        screen.endCheck(older)
        join.settle()
        await consume.value
        #expect(screen.screen == .home, "the late join routed past the newest check's reset")
        #expect(screen.pendingInvite == "invite-1")

        screen.resetRoute(forCheck: newest)
        await consumeAgain(on: screen, joining: "buddy-1")
        screen.endCheck(newest)

        #expect(screen.screen == .buddySession("buddy-1"))
        #expect(screen.pendingInvite == nil)
    }

    /// The check the join deferred to ends without a reset, at the offline fallback.
    /// The invite is not lost. It stays pending for the next consume, here the reconnect
    /// refresh, which opens the session.
    @Test func testAnInviteLeftToACheckThatEndsWithoutAResetWaitsForTheNextConsume() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()

        let check = screen.startCheck()
        join.settle()
        await consume.value
        screen.endCheck(check)
        #expect(screen.screen == .home)
        #expect(screen.pendingInvite == "invite-1")

        await consumeAgain(on: screen, joining: "buddy-1")

        #expect(screen.screen == .buddySession("buddy-1"))
        #expect(screen.pendingInvite == nil)
    }

    /// A sign-out during the join outranks both deferrals, as before #856. The join opens
    /// nothing on the sign-in screen, and the invite it carried is dropped so the next
    /// account does not inherit it.
    @Test func testASignOutDuringTheJoinOpensNothingAndDropsTheInvite() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let join = HeldSave(settlingWith: "buddy-1")
        let consume = screen.consumeInvite(joining: join)
        await join.untilStarted()

        screen.signOut()
        join.settle()

        await consume.value
        #expect(screen.screen == .signIn, "the late join routed the signed-out screen")
        #expect(screen.pendingInvite == nil)
    }

    // MARK: - #989: the in-flight gate across a sign-out

    /// The previous account's join is still out when the next account signs in with
    /// an invite of its own. The next account's first consume joins at once instead of
    /// returning at a flag the stale join still holds.
    @Test func testANextAccountsFirstConsumeIsNotBlockedByAStaleJoin() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let staleJoin = HeldSave(settlingWith: "buddy-1")
        let stale = screen.consumeInvite(joining: staleJoin)
        await staleJoin.untilStarted()

        screen.signOut()
        screen.receiveInvite("invite-2")
        screen.signIn("user-b")
        await consumeAgain(on: screen, joining: "buddy-2")

        #expect(screen.screen == .buddySession("buddy-2"), "the stale join blocked the next account's consume")
        #expect(screen.joinsSent == ["invite-1", "invite-2"])

        staleJoin.settle()
        await stale.value
        #expect(screen.screen == .buddySession("buddy-2"), "the stale join routed the next account")
    }

    /// The stale join returns while the next account's join is in flight. Its release
    /// must not free the gate under the newer attempt, or a second consume of the same
    /// account would POST that token again.
    @Test func testAStaleJoinsReleaseDoesNotFreeANewerAttempt() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let staleJoin = HeldSave(settlingWith: "buddy-1")
        let stale = screen.consumeInvite(joining: staleJoin)
        await staleJoin.untilStarted()

        screen.signOut()
        screen.receiveInvite("invite-2")
        screen.signIn("user-b")
        let liveJoin = HeldSave(settlingWith: "buddy-2")
        let live = screen.consumeInvite(joining: liveJoin)
        await liveJoin.untilStarted()

        staleJoin.settle()
        await stale.value
        // An overlapping consume for the live account: return-home, say.
        await consumeAgain(on: screen, joining: "buddy-2")
        #expect(screen.joinsSent == ["invite-1", "invite-2"], "the live token was posted twice")

        liveJoin.settle()
        await live.value
        #expect(screen.screen == .buddySession("buddy-2"))
        #expect(screen.pendingInvite == nil)
    }

    /// A sign-out that keeps the pending invite (`applySignedOut`) must not let the next
    /// account POST the token the stale join is still posting. The stale join drops it.
    @Test func testTheNextAccountCannotRepostTheTokenAStaleJoinHolds() async {
        let screen = InviteScreen(signedIn: "user-a", pendingInvite: "invite-1")
        let staleJoin = HeldSave(settlingWith: "buddy-1")
        let stale = screen.consumeInvite(joining: staleJoin)
        await staleJoin.untilStarted()

        screen.signOut()
        screen.signIn("user-b")
        await consumeAgain(on: screen, joining: "buddy-1")
        #expect(screen.joinsSent == ["invite-1"], "the next account posted the stale join's token")

        staleJoin.settle()
        await stale.value
        #expect(screen.pendingInvite == nil, "the stale join's token was inherited")
        #expect(screen.screen == .home)
    }
}
