import XCTest
@testable import StillPointShared

/// Issue #827 — `checkAuth()` runs from `.task` and on every scene activation, so two
/// checks for the same account overlap, and only the newest may act on the account
/// once it is adopted: reset the route, then consume the pending session, log-reason
/// and buddy-invite links. The tests play out the overlaps that matter, each with a
/// session link pending, and pin which check may consume it — the rule the three
/// guards in that follow-up share.
final class AuthCheckOwnershipTests: XCTestCase {
    private func isCurrent(_ checkID: Int, newest: Int, adoptedAt generation: Int, live: Int) -> Bool {
        AuthCheckOwnership.isCurrent(
            checkID: checkID,
            newestCheckID: newest,
            generation: generation,
            liveGeneration: live
        )
    }

    /// With nothing overlapping, the check that adopted the account consumes the link.
    func testALoneCheckOwnsItsFollowUp() {
        XCTAssertTrue(isCurrent(1, newest: 1, adoptedAt: 1, live: 1))
    }

    /// The #827 race. Check A adopts the account at generation 1, resets the route and
    /// suspends in its badge refresh. Check B starts on a scene activation and
    /// re-confirms the same account, which leaves the generation at 1 — so the
    /// generation-only guard that used to follow the refresh gave both checks the same
    /// answer. A resumes with the link still pending and must leave it to B: B's route
    /// reset lands after anything A opens, so a link A consumed would be spent on a
    /// screen the user never keeps.
    func testSupersededSameAccountCheckLeavesThePendingLinkToTheNewest() {
        let generation = 1
        let checkA = 1
        let checkB = 2

        XCTAssertFalse(
            isCurrent(checkA, newest: checkB, adoptedAt: generation, live: generation),
            "A was superseded, so it must not consume the link after its refresh"
        )
        XCTAssertTrue(
            isCurrent(checkB, newest: checkB, adoptedAt: generation, live: generation),
            "B is the newest check, so it consumes the link after its own route reset"
        )
    }

    /// The tail's second suspension point. Check A passes the post-refresh guard and
    /// starts joining a pending buddy invite. Check C starts while the join is in
    /// flight. When the join returns, A must leave the session link to C.
    func testACheckStartedDuringTheInviteJoinTakesTheLocalLinks() {
        let generation = 1
        let checkA = 1
        let checkC = 2

        XCTAssertTrue(
            isCurrent(checkA, newest: checkA, adoptedAt: generation, live: generation),
            "A was still the newest when the join started"
        )
        XCTAssertFalse(
            isCurrent(checkA, newest: checkC, adoptedAt: generation, live: generation),
            "C started during the join, so A must not consume the session link"
        )
    }

    /// A sign-out or an account switch while a check is suspended ends it, even when it
    /// is the newest one. What happens to the link then belongs to that transition, not
    /// to this check.
    func testAnIdentityChangeEndsEvenTheNewestCheck() {
        XCTAssertFalse(isCurrent(2, newest: 2, adoptedAt: 1, live: 2))
    }

    /// The newest check adopted a different account, which moved the generation. The
    /// older check, adopted under the previous account, owns nothing. The newest owns
    /// the follow-up under the generation it adopted.
    func testNewestCheckThatSwitchedAccountsOwnsTheFollowUpUnderTheNewGeneration() {
        let older = 1
        let newest = 2

        XCTAssertFalse(isCurrent(older, newest: newest, adoptedAt: 1, live: 2))
        XCTAssertTrue(isCurrent(newest, newest: newest, adoptedAt: 2, live: 2))
    }

    /// A cold start can run two checks back to back (`.task`, then the first
    /// `scenePhase == .active`), and a later activation can add a third before either
    /// finishes. All three confirm the same account. Only the last may consume the link.
    func testOnlyTheLastOfThreeOverlappingChecksConsumesTheLink() {
        let generation = 1
        let coldStart = 1
        let firstActivation = 2
        let laterActivation = 3

        for superseded in [coldStart, firstActivation] {
            XCTAssertFalse(
                isCurrent(superseded, newest: laterActivation, adoptedAt: generation, live: generation),
                "check \(superseded) was superseded, so it must leave the link"
            )
        }
        XCTAssertTrue(isCurrent(laterActivation, newest: laterActivation, adoptedAt: generation, live: generation))
    }
}
