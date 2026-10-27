import XCTest
@testable import StillPointShared

/// Issue #989: the buddy-invite consume gate is owned per attempt. A previous account's
/// join still in flight after a sign-out must neither block the next account's consume
/// nor, when it returns, free the gate under that account's own join. The token it is
/// posting stays blocked across the generation change, so it is never sent twice.
final class BuddyInviteConsumeGateTests: XCTestCase {
    /// One join at a time within a generation (#756).
    func testASecondConsumeInTheSameGenerationIsBlocked() {
        var gate = BuddyInviteConsumeGate()
        XCTAssertNotNil(gate.acquire(generation: 1, token: "invite-1"))
        XCTAssertNil(gate.acquire(generation: 1, token: "invite-1"))
        XCTAssertNil(gate.acquire(generation: 1, token: "invite-2"))
        XCTAssertTrue(gate.isHeld(liveGeneration: 1))
    }

    /// The bug: the previous account's join used to hold one `Bool`, so the next
    /// account's first consume returned early.
    func testAStaleAttemptDoesNotBlockTheNextGenerationsOtherToken() {
        var gate = BuddyInviteConsumeGate()
        XCTAssertNotNil(gate.acquire(generation: 1, token: "invite-1"))
        XCTAssertFalse(gate.isHeld(liveGeneration: 2))
        XCTAssertFalse(gate.blocks(generation: 2, token: "invite-2"))
        XCTAssertNotNil(gate.acquire(generation: 2, token: "invite-2"))
    }

    /// `applySignedOut` keeps the pending token. The next account must not POST the
    /// one the stale join is still posting.
    func testAStaleAttemptStillBlocksItsOwnToken() {
        var gate = BuddyInviteConsumeGate()
        XCTAssertNotNil(gate.acquire(generation: 1, token: "invite-1"))
        XCTAssertTrue(gate.blocks(generation: 2, token: "invite-1"))
        XCTAssertNil(gate.acquire(generation: 2, token: "invite-1"))
    }

    /// The stale join's release frees only its own attempt, so the newer one keeps
    /// holding the gate for its generation.
    func testAStaleReleaseLeavesTheNewerAttemptHeld() throws {
        var gate = BuddyInviteConsumeGate()
        let stale = try XCTUnwrap(gate.acquire(generation: 1, token: "invite-1"))
        let live = try XCTUnwrap(gate.acquire(generation: 2, token: "invite-2"))

        gate.release(stale)

        XCTAssertTrue(gate.isHeld(liveGeneration: 2))
        XCTAssertNil(gate.acquire(generation: 2, token: "invite-2"), "the stale release freed the live attempt")
        gate.release(live)
        XCTAssertFalse(gate.isHeld(liveGeneration: 2))
        XCTAssertTrue(gate.inFlight.isEmpty)
    }

    /// The consume releases early before its re-consume and again in its `defer`.
    /// The second release must not free a re-consume that took the gate in between.
    func testReleasingTwiceDoesNotFreeALaterAttempt() throws {
        var gate = BuddyInviteConsumeGate()
        let first = try XCTUnwrap(gate.acquire(generation: 1, token: "invite-1"))
        gate.release(first)
        let reconsume = try XCTUnwrap(gate.acquire(generation: 1, token: "invite-2"))

        gate.release(first)

        XCTAssertTrue(gate.isHeld(liveGeneration: 1))
        gate.release(reconsume)
        XCTAssertFalse(gate.isHeld(liveGeneration: 1))
    }

    /// A caller that checks before reading the token blocks on the generation alone.
    func testANilTokenBlocksOnTheGenerationOnly() {
        var gate = BuddyInviteConsumeGate()
        XCTAssertNotNil(gate.acquire(generation: 1, token: "invite-1"))
        XCTAssertTrue(gate.blocks(generation: 1, token: nil))
        XCTAssertFalse(gate.blocks(generation: 2, token: nil))
    }
}
